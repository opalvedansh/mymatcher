import { AppState, Platform } from 'react-native';
import { io, Socket } from 'socket.io-client';
import { supabase } from '../supabase';
import Constants from 'expo-constants';
import type { ChatMessage, ChatMessageKind, ChatReaction } from './types';

// ─── Network-agnostic API URL ──────────────────────────────────────
// Defaults to the deployed production API so the app works from any
// network (WiFi, cellular, hotel, VPN...) without extra setup.
// To point at a local backend during development, set
// EXPO_PUBLIC_API_URL in .env (e.g. to your Mac's LAN IP) — or set
// EXPO_PUBLIC_USE_LOCAL_API=1 to auto-detect the Metro bundler's host.
function getBaseUrl(): string {
  if (process.env.EXPO_PUBLIC_API_URL) {
    return process.env.EXPO_PUBLIC_API_URL;
  }
  if (__DEV__ && process.env.EXPO_PUBLIC_USE_LOCAL_API) {
    const debuggerHost = Constants.expoConfig?.hostUri ?? Constants.manifest2?.extra?.expoGo?.debuggerHost;
    const host = debuggerHost?.split(':')[0] ?? 'localhost';
    return `http://${host}:3000`;
  }
  return 'https://api.mymatchr.in';
}

// Chat can run as its own service; without a separate URL it shares the API's.
const SOCKET_URL = process.env.EXPO_PUBLIC_SOCKET_URL || getBaseUrl();
const ACK_TIMEOUT_MS = 10000;

type StatusListener = (connected: boolean) => void;
type MatchClosedListener = (matchId: string) => void;

export type AckResult<T = {}> = ({ ok: true } & T) | { ok: false; error: string };
export type SendResult = AckResult<{ message: ChatMessage; duplicate?: boolean }>;

/** What a send carries besides text. `attachment.path` comes from requestChatUpload. */
export interface SendPayload {
  kind?: ChatMessageKind;
  content?: string;
  replyToId?: string | null;
  attachment?: {
    path: string;
    mime: string;
    name?: string;
    width?: number;
    height?: number;
    duration_ms?: number;
    waveform?: number[];
  };
}

/** Server → client events and their payloads. */
export interface ChatEvents {
  receive_message: ChatMessage;
  message_updated: ChatMessage;
  message_reactions: { matchId: string; messageId: string; reactions: ChatReaction[] };
  messages_delivered: { matchId: string; at: string };
  messages_read: { matchId: string; readerId: string; at: string };
  messages_hidden: { matchId: string; ids: string[] };
  chat_cleared: { matchId: string; at: string };
  typing: { matchId?: string; userId: string; isTyping: boolean; kind?: 'text' | 'audio' };
  presence: { userId: string; online: boolean; last_seen_at: string | null };
  match_closed: { matchId: string };
}
type EventName = keyof ChatEvents;
type Handler<E extends EventName> = (payload: ChatEvents[E]) => void;

class SocketService {
  private socket: Socket | null = null;
  private connecting: Promise<void> | null = null;
  private currentMatchId: string | null = null;
  // Rooms don't survive a reconnect; these are rejoined on every connect.
  private watchedPresence = new Map<string, number>();
  private statusListeners: Set<StatusListener> = new Set();
  private matchClosedListeners: Set<MatchClosedListener> = new Set();
  // Subscriptions live here, not on the socket, so they survive a new socket.
  private handlers = new Map<string, Set<(payload: any) => void>>();
  private reconnectListeners = new Set<() => void>();
  private isConnected: boolean = false;
  private hasConnectedOnce = false;
  private suspended = false;
  private userId: string | null = null;
  private deliveredQueue = new Set<string>();
  private deliveredTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    // A backgrounded iOS app is suspended within seconds, but the server only
    // notices after its ping timeout, so the person looks "online" meanwhile.
    // Disconnecting makes last seen accurate; coming back reconnects, which
    // also delivers anything that arrived in the meantime. Web keeps its
    // socket: a background tab still wants live messages.
    if (Platform.OS !== 'web') {
      AppState.addEventListener('change', (state) => {
        if (state === 'background') this.suspend();
        else if (state === 'active') this.resume();
      });
    }
  }

  private notifyStatus(connected: boolean) {
    this.isConnected = connected;
    this.statusListeners.forEach((fn) => fn(connected));
  }

  private dispatch(event: string, payload: unknown) {
    this.handlers.get(event)?.forEach((fn) => {
      try {
        fn(payload);
      } catch (err) {
        console.warn(`[Socket] ${event} handler failed`, err);
      }
    });
  }

  /**
   * Connects to the WebSocket server using the current Supabase JWT token.
   * Safe to call repeatedly: there is only ever one socket.
   */
  async connect() {
    if (this.socket) {
      if (!this.socket.connected && !this.suspended) this.socket.connect();
      return;
    }
    if (this.connecting) return this.connecting;
    this.connecting = this.open().finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }

  private async open() {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;

    if (!token) {
      console.warn('[Socket] No valid session token available');
      return;
    }
    if (this.socket) return;
    this.userId = session?.user?.id ?? null;

    console.log('[Socket] Connecting to:', SOCKET_URL);
    const socket = io(SOCKET_URL, {
      auth: { token },
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1500,
      reconnectionDelayMax: 10000,
    });
    this.socket = socket;

    socket.on('connect', () => {
      console.log('[Socket] Connected to server:', socket.id);
      if (this.currentMatchId) socket.emit('join_match', this.currentMatchId);
      for (const userId of this.watchedPresence.keys()) {
        socket.timeout(ACK_TIMEOUT_MS).emitWithAck('watch_presence', { userId })
          .then((res: any) => {
            if (res?.ok) this.dispatch('presence', { userId, online: res.online, last_seen_at: res.last_seen_at });
          })
          .catch(() => {});
      }
      this.notifyStatus(true);
      // Anything could have arrived while disconnected: open screens refetch.
      if (this.hasConnectedOnce) this.reconnectListeners.forEach((fn) => fn());
      this.hasConnectedOnce = true;
    });

    socket.onAny((event: string, payload: unknown) => this.dispatch(event, payload));

    // This device has the message: the sender's grey double tick. Batched,
    // because a reconnect or a busy chat delivers several at once.
    socket.on('receive_message', (msg: ChatMessage) => {
      if (msg?.id && msg.sender_id !== this.userId && !msg.delivered_at && !msg.read_at) this.queueDelivered(msg.id);
    });

    socket.on('match_closed', ({ matchId }: { matchId: string }) => {
      this.matchClosedListeners.forEach((fn) => fn(matchId));
    });

    // Banned or signed out server-side: stop reconnecting.
    socket.on('session_ended', () => {
      this.disconnect();
    });

    socket.on('connect_error', (err) => {
      console.warn('[Socket] Connection Error:', err.message);
      this.notifyStatus(false);
    });

    socket.on('disconnect', (reason) => {
      console.log('[Socket] Disconnected:', reason);
      this.notifyStatus(false);
    });

    // Sends report failures through their acks; this only covers the rest.
    socket.on('error', (err) => {
      console.warn('[Socket] Server Error:', err);
    });
  }

  private queueDelivered(messageId: string) {
    this.deliveredQueue.add(messageId);
    if (this.deliveredTimer) return;
    this.deliveredTimer = setTimeout(() => {
      const ids = [...this.deliveredQueue];
      this.deliveredQueue.clear();
      this.deliveredTimer = null;
      // Offline: the server marks everything delivered on the next connect anyway.
      this.markDelivered(ids);
    }, 250);
  }

  private suspend() {
    if (!this.socket || this.suspended) return;
    this.suspended = true;
    this.socket.disconnect();
  }

  private resume() {
    if (!this.suspended) return;
    this.suspended = false;
    this.socket?.connect();
  }

  /**
   * Fix 3: Updates the auth token and reconnects if necessary.
   * Called every time Supabase refreshes the JWT (happens hourly).
   */
  updateToken(newToken: string) {
    if (!this.socket) return;
    // Update the auth token on the socket instance
    this.socket.auth = { token: newToken };
    // Keep an open connection authorised past the old token's expiry.
    if (this.socket.connected) {
      this.socket.emit('refresh_token', newToken);
    } else if (!this.suspended) {
      console.log('[Socket] Reconnecting with refreshed token...');
      this.socket.connect();
    }
  }

  /**
   * Fix 4: Subscribe to connection status changes.
   * Returns an unsubscribe function.
   */
  onStatusChange(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    // Immediately emit current status to new subscribers
    listener(this.isConnected);
    return () => this.statusListeners.delete(listener);
  }

  get connected() {
    return this.isConnected;
  }

  /** Subscribes to a server event. Returns an unsubscribe function. */
  on<E extends EventName>(event: E, handler: Handler<E>): () => void {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(handler);
    return () => this.handlers.get(event)?.delete(handler);
  }

  /** Called after the socket comes back from a disconnect. Returns an unsubscribe function. */
  onReconnect(listener: () => void): () => void {
    this.reconnectListeners.add(listener);
    return () => this.reconnectListeners.delete(listener);
  }

  private request<T>(event: string, payload: unknown): Promise<AckResult<T>> {
    const socket = this.socket;
    if (!socket?.connected) return Promise.resolve({ ok: false, error: 'offline' });
    return socket
      .timeout(ACK_TIMEOUT_MS)
      .emitWithAck(event, payload)
      .catch(() => ({ ok: false as const, error: 'timeout' }));
  }

  /**
   * Joins a specific match room: typing indicators and "conversation ended"
   * arrive through it.
   */
  joinMatch(matchId: string) {
    // Remembered even while connecting: the 'connect' handler joins it then.
    this.currentMatchId = matchId;
    if (!this.socket?.connected) return;
    this.socket.emit('join_match', matchId);
  }

  leaveMatch(matchId: string) {
    if (this.currentMatchId === matchId) this.currentMatchId = null;
    this.socket?.emit('leave_match', matchId);
  }

  /**
   * Sends a message and resolves once the server has stored it. Passing the
   * same clientId again (a retry) never creates a second copy.
   */
  sendMessage(matchId: string, content: string, clientId: string, extra: SendPayload = {}): Promise<SendResult> {
    return this.request('send_message', { matchId, content, clientId, ...extra });
  }

  editMessage(messageId: string, content: string) {
    return this.request<{ message: ChatMessage }>('edit_message', { messageId, content });
  }

  deleteForEveryone(messageId: string) {
    return this.request<{ message: ChatMessage }>('delete_message', { messageId, scope: 'everyone' });
  }

  deleteForMe(matchId: string, messageIds: string[]) {
    return this.request<{ ids: string[] }>('delete_message', { matchId, messageIds, scope: 'me' });
  }

  /** A falsy emoji removes my reaction. */
  react(messageId: string, emoji: string | null) {
    return this.request<{ reactions: ChatReaction[] }>('react_message', { messageId, emoji });
  }

  forward(messageId: string, matchIds: string[]) {
    return this.request<{ messages: ChatMessage[] }>('forward_message', { messageId, matchIds });
  }

  markRead(matchId: string) {
    return this.request<{ count: number }>('mark_read', { matchId });
  }

  markDelivered(messageIds: string[]) {
    return this.request('mark_delivered', { messageIds });
  }

  typing(matchId: string, isTyping: boolean, kind: 'text' | 'audio' = 'text') {
    this.socket?.volatile.emit('typing', { matchId, isTyping, kind });
  }

  /**
   * Online / last seen for someone I'm matched with. Updates arrive as
   * 'presence' events until unwatchPresence.
   */
  async watchPresence(userId: string) {
    this.watchedPresence.set(userId, (this.watchedPresence.get(userId) ?? 0) + 1);
    return this.request<{ online: boolean; last_seen_at: string | null }>('watch_presence', { userId });
  }

  unwatchPresence(userId: string) {
    const count = (this.watchedPresence.get(userId) ?? 1) - 1;
    if (count > 0) {
      this.watchedPresence.set(userId, count);
      return;
    }
    this.watchedPresence.delete(userId);
    this.socket?.emit('unwatch_presence', { userId });
  }

  /** Fires when a conversation ends (block or unmatch). Returns an unsubscribe function. */
  onMatchClosed(listener: MatchClosedListener): () => void {
    this.matchClosedListeners.add(listener);
    return () => this.matchClosedListeners.delete(listener);
  }

  /** @deprecated Use `on('receive_message', …)`, which survives reconnects. */
  onReceiveMessage(callback: (message: ChatMessage) => void) {
    this.on('receive_message', callback);
  }

  /** @deprecated Use the unsubscribe function returned by `on`. */
  offReceiveMessage(callback: (message: ChatMessage) => void) {
    this.handlers.get('receive_message')?.delete(callback);
  }

  /**
   * Disconnects the socket completely.
   */
  disconnect() {
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.disconnect();
      this.socket = null;
      this.currentMatchId = null;
      this.watchedPresence.clear();
      this.hasConnectedOnce = false;
      this.suspended = false;
      this.userId = null;
      this.notifyStatus(false);
    }
  }
}

export const socketService = new SocketService();
