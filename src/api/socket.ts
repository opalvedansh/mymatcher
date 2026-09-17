import { io, Socket } from 'socket.io-client';
import { supabase } from '../supabase';
import Constants from 'expo-constants';
import type { ChatMessage } from './types';

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
const SEND_TIMEOUT_MS = 10000;

type StatusListener = (connected: boolean) => void;
type MatchClosedListener = (matchId: string) => void;

export type SendResult =
  | { ok: true; message: ChatMessage }
  | { ok: false; error: string };

class SocketService {
  private socket: Socket | null = null;
  private currentMatchId: string | null = null;
  // Fix 4: Track connection status for UI awareness
  private statusListeners: Set<StatusListener> = new Set();
  private matchClosedListeners: Set<MatchClosedListener> = new Set();
  private isConnected: boolean = false;

  private notifyStatus(connected: boolean) {
    this.isConnected = connected;
    this.statusListeners.forEach((fn) => fn(connected));
  }

  /**
   * Connects to the WebSocket server using the current Supabase JWT token.
   */
  async connect() {
    if (this.socket?.connected) return;

    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    
    if (!token) {
      console.warn('[Socket] No valid session token available');
      return;
    }

    console.log('[Socket] Connecting to:', SOCKET_URL);
    this.socket = io(SOCKET_URL, {
      auth: { token },
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1500,
    });

    this.socket.on('connect', () => {
      console.log('[Socket] Connected to server:', this.socket?.id);
      // Rooms don't survive a reconnect, so rejoin the open conversation.
      if (this.currentMatchId) this.socket?.emit('join_match', this.currentMatchId);
      this.notifyStatus(true);
    });

    this.socket.on('match_closed', ({ matchId }: { matchId: string }) => {
      this.matchClosedListeners.forEach((fn) => fn(matchId));
    });

    // Banned or signed out server-side: stop reconnecting.
    this.socket.on('session_ended', () => {
      this.disconnect();
    });

    this.socket.on('connect_error', (err) => {
      console.error('[Socket] Connection Error:', err.message);
      this.notifyStatus(false);
    });

    this.socket.on('disconnect', (reason) => {
      console.log('[Socket] Disconnected:', reason);
      this.notifyStatus(false);
    });
    
    this.socket.on('error', (err) => {
      console.error('[Socket] Server Error:', err);
    });
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
    }
    // If the socket is currently disconnected, try to reconnect with the fresh token
    if (!this.socket.connected) {
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

  /**
   * Joins a specific match room to receive messages.
   */
  joinMatch(matchId: string) {
    // Remembered even while connecting: the 'connect' handler joins it then.
    this.currentMatchId = matchId;
    if (!this.socket?.connected) return;
    this.socket.emit('join_match', matchId);
    console.log(`[Socket] Joined match room: ${matchId}`);
  }

  /**
   * Sends a message to the currently joined match.
   */
  /**
   * Sends a message and resolves once the server has stored it. Passing the
   * same clientId again (a retry) never creates a second copy.
   */
  sendMessage(matchId: string, content: string, clientId: string): Promise<SendResult> {
    const socket = this.socket;
    if (!socket?.connected) return Promise.resolve({ ok: false, error: 'offline' });
    return socket
      .timeout(SEND_TIMEOUT_MS)
      .emitWithAck('send_message', { matchId, content, clientId })
      .catch(() => ({ ok: false as const, error: 'timeout' }));
  }

  /** Fires when a conversation ends (block or unmatch). Returns an unsubscribe function. */
  onMatchClosed(listener: MatchClosedListener): () => void {
    this.matchClosedListeners.add(listener);
    return () => this.matchClosedListeners.delete(listener);
  }

  leaveMatch(matchId: string) {
    if (this.currentMatchId === matchId) this.currentMatchId = null;
  }

  /**
   * Listens for incoming messages.
   */
  onReceiveMessage(callback: (message: any) => void) {
    if (!this.socket) return;
    this.socket.on('receive_message', callback);
  }

  /**
   * Removes message listener.
   */
  offReceiveMessage(callback: (message: any) => void) {
    if (!this.socket) return;
    this.socket.off('receive_message', callback);
  }

  /**
   * Disconnects the socket completely.
   */
  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
      this.currentMatchId = null;
      this.notifyStatus(false);
    }
  }
}

export const socketService = new SocketService();
