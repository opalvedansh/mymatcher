import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import * as Crypto from 'expo-crypto';
import { getMessages } from '@/api';
import { socketService } from '@/api/socket';
import type { ChatMemberState, ChatMessage, ChatMessageKind, ChatReplyPreview } from '@/api/types';
import { showAlert } from '@/components/ActionSheet';
import { uploadChatFile, type LocalFile } from './upload';
import type { SendState } from './MessageBubble';

const PAGE_SIZE = 50;
// Throttle for re-announcing "typing…"; the other side clears it after 6 s.
const TYPING_REFRESH_MS = 4000;
const TYPING_IDLE_MS = 3000;
const TYPING_EXPIRY_MS = 6000;

const SEND_ERRORS: Record<string, string> = {
  offline: 'No connection',
  timeout: 'No connection',
  rate_limited: 'Sending too fast',
  too_long: 'Too long',
  empty: 'Empty message',
  not_found: 'This chat has ended',
  upload_missing: 'Upload failed',
  unsupported_type: 'This file type can\'t be sent',
  too_large: 'File is too large',
  bad_attachment: 'Upload failed',
  bad_reply: 'The quoted message is gone',
  server_error: 'Something went wrong',
};
// Failures that a better connection fixes; they are retried automatically.
const TRANSIENT = new Set(['offline', 'timeout', 'server_error', 'upload']);

interface PendingSend {
  kind: ChatMessageKind;
  text: string;
  replyToId: string | null;
  file?: LocalFile;
  uploaded?: { path: string; mime: string };
  controller?: AbortController;
  errorCode?: string;
}

const isTemp = (m: ChatMessage) => m.id.startsWith('temp-');
const byTime = (a: ChatMessage, b: ChatMessage) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0);

/** Keeps this device's own copy of a file on screen after the server copy replaces it. */
function withLocal(old: ChatMessage | undefined, next: ChatMessage): ChatMessage {
  const local = old?.attachment?.local_uri;
  if (!local || !next.attachment) return next;
  return { ...next, attachment: { ...next.attachment, local_uri: local } };
}

/** Merges messages in by id (an optimistic copy is replaced by its client id), oldest first. */
function merge(prev: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  if (!incoming.length) return prev;
  const byId = new Map(prev.map((m) => [m.id, m]));
  for (const msg of incoming) {
    const tempId = msg.client_msg_id ? `temp-${msg.client_msg_id}` : null;
    const temp = tempId ? byId.get(tempId) : undefined;
    if (temp) {
      byId.delete(tempId!);
      byId.set(msg.id, withLocal(temp, msg));
    } else {
      byId.set(msg.id, withLocal(byId.get(msg.id), msg));
    }
  }
  return [...byId.values()].sort(byTime);
}

export function replyPreviewOf(m: ChatMessage): ChatReplyPreview {
  const image = m.kind === 'image' && m.attachment;
  return {
    id: m.id,
    sender_id: m.sender_id,
    kind: m.kind ?? 'text',
    text: m.deleted_at ? '' : m.content.slice(0, 200),
    deleted: !!m.deleted_at,
    name: m.attachment?.name ?? null,
    duration_ms: m.attachment?.duration_ms ?? null,
    thumb_url: image ? m.attachment!.local_uri ?? m.attachment!.url : null,
    thumb_key: image ? m.attachment!.key : null,
  };
}

export function useConversation({ matchId, myId, otherUserId }: { matchId: string; myId?: string; otherUserId: string }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [memberState, setMemberState] = useState<ChatMemberState | null>(null);
  const [closed, setClosed] = useState(false);
  const [sendStates, setSendStates] = useState<Record<string, SendState>>({});
  const [otherTyping, setOtherTyping] = useState<'text' | 'audio' | null>(null);
  const [presence, setPresence] = useState<{ online: boolean; last_seen_at: string | null } | null>(null);
  const [firstUnreadId, setFirstUnreadId] = useState<string | null>(null);

  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const pending = useRef(new Map<string, PendingSend>());
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const setSend = useCallback((clientId: string, state: SendState | null) => {
    if (!mounted.current) return;
    setSendStates((prev) => {
      if (!state) {
        if (!(clientId in prev)) return prev;
        const next = { ...prev };
        delete next[clientId];
        return next;
      }
      return { ...prev, [clientId]: state };
    });
  }, []);

  // ── History ──────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(false);
        const res = await getMessages(matchId, PAGE_SIZE);
        if (cancelled) return;
        const page = [...res.data].reverse();
        // Loaded before the server marked them read: where "unread" starts.
        const firstUnread = page.find((m) => m.sender_id !== myId && !m.read_at && !m.deleted_at);
        setFirstUnreadId(firstUnread && page[0]?.id !== firstUnread.id ? firstUnread.id : null);
        setMessages((prev) => merge(prev.filter(isTemp), page));
        setHasMore(!!res.next_cursor);
        if (res.state) setMemberState(res.state);
      } catch (e) {
        console.warn('Failed to load messages', e);
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [matchId, myId, reloadKey]);

  const loadOlder = useCallback(async () => {
    if (loadingOlder || !hasMore) return;
    const oldest = messagesRef.current.find((m) => !isTemp(m));
    if (!oldest) return;
    setLoadingOlder(true);
    try {
      const res = await getMessages(matchId, PAGE_SIZE, oldest.created_at);
      if (!mounted.current) return;
      setMessages((prev) => merge(prev, res.data));
      setHasMore(!!res.next_cursor);
    } catch (e) {
      console.warn('Failed to load older messages', e);
    } finally {
      if (mounted.current) setLoadingOlder(false);
    }
  }, [matchId, hasMore, loadingOlder]);

  /** Catches up after a reconnect: anything sent while this device was away. */
  const refreshLatest = useCallback(async () => {
    try {
      const res = await getMessages(matchId, PAGE_SIZE);
      if (mounted.current) setMessages((prev) => merge(prev, res.data));
    } catch {
      // The next reconnect or reopen catches up.
    }
  }, [matchId]);

  // ── Read receipts ────────────────────────────────────────────────
  const readTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const markReadSoon = useCallback(() => {
    if (readTimer.current) clearTimeout(readTimer.current);
    readTimer.current = setTimeout(() => {
      // Only what the person can actually see counts as read.
      if (AppState.currentState !== 'active') return;
      socketService.markRead(matchId);
    }, 400);
  }, [matchId]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      const unread = messagesRef.current.some((m) => m.sender_id !== myId && !m.read_at && !m.deleted_at);
      if (unread) markReadSoon();
    });
    return () => {
      sub.remove();
      if (readTimer.current) clearTimeout(readTimer.current);
    };
  }, [markReadSoon, myId]);

  // ── Live updates ─────────────────────────────────────────────────
  useEffect(() => {
    socketService.connect();
    socketService.joinMatch(matchId);

    const typingExpiry: { timer: ReturnType<typeof setTimeout> | null } = { timer: null };
    const markOwn = (at: string, field: 'delivered_at' | 'read_at') => setMessages((prev) => prev.map((m) => {
      if (m.sender_id !== myId || isTemp(m) || m.created_at > at || m[field]) return m;
      return field === 'read_at'
        ? { ...m, read_at: at, delivered_at: m.delivered_at ?? at }
        : { ...m, delivered_at: at };
    }));

    const offs = [
      socketService.on('receive_message', (msg) => {
        if (msg.match_id && msg.match_id !== matchId) return;
        setMessages((prev) => merge(prev, [msg]));
        if (msg.sender_id !== myId) {
          setOtherTyping(null);
          markReadSoon();
        }
      }),
      socketService.on('message_updated', (msg) => {
        if (msg.match_id !== matchId) return;
        // Only replace what is already on screen (a hidden or cleared message stays gone).
        setMessages((prev) => (prev.some((m) => m.id === msg.id) ? merge(prev, [msg]) : prev));
      }),
      socketService.on('message_reactions', ({ matchId: id, messageId, reactions }) => {
        if (id !== matchId) return;
        setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, reactions } : m)));
      }),
      socketService.on('messages_delivered', ({ matchId: id, at }) => {
        if (id === matchId) markOwn(at, 'delivered_at');
      }),
      socketService.on('messages_read', ({ matchId: id, readerId, at }) => {
        if (id !== matchId) return;
        if (readerId === myId) {
          setMessages((prev) => prev.map((m) => (m.sender_id !== myId && !m.read_at && m.created_at <= at ? { ...m, read_at: at } : m)));
        } else {
          markOwn(at, 'read_at');
        }
      }),
      socketService.on('messages_hidden', ({ matchId: id, ids }) => {
        if (id !== matchId) return;
        const hidden = new Set(ids);
        setMessages((prev) => prev.filter((m) => !hidden.has(m.id)));
      }),
      socketService.on('chat_cleared', ({ matchId: id, at }) => {
        if (id === matchId) setMessages((prev) => prev.filter((m) => isTemp(m) || m.created_at > at));
      }),
      socketService.on('typing', ({ matchId: id, userId, isTyping, kind }) => {
        if (id !== matchId || userId !== otherUserId) return;
        if (typingExpiry.timer) clearTimeout(typingExpiry.timer);
        setOtherTyping(isTyping ? kind ?? 'text' : null);
        // A lost "stopped typing" must not leave the indicator up forever.
        if (isTyping) typingExpiry.timer = setTimeout(() => setOtherTyping(null), TYPING_EXPIRY_MS);
      }),
      socketService.on('presence', (p) => {
        if (p.userId === otherUserId) setPresence({ online: p.online, last_seen_at: p.last_seen_at });
      }),
      socketService.onMatchClosed((closedId) => {
        if (closedId === matchId) setClosed(true);
      }),
      socketService.onReconnect(() => {
        refreshLatest();
        // Anything that failed for want of a connection goes out now.
        for (const [clientId, p] of pending.current) {
          if (p.errorCode && TRANSIENT.has(p.errorCode)) deliverRef.current(clientId);
        }
      }),
    ];

    socketService.watchPresence(otherUserId).then((res) => {
      if (res.ok && mounted.current) setPresence({ online: res.online, last_seen_at: res.last_seen_at });
    });

    return () => {
      offs.forEach((off) => off());
      if (typingExpiry.timer) clearTimeout(typingExpiry.timer);
      socketService.leaveMatch(matchId);
      socketService.unwatchPresence(otherUserId);
    };
  }, [matchId, myId, otherUserId, markReadSoon, refreshLatest]);

  // ── Sending ──────────────────────────────────────────────────────
  const deliver = useCallback(async (clientId: string) => {
    const p = pending.current.get(clientId);
    if (!p) return;
    p.errorCode = undefined;
    try {
      if (p.file && !p.uploaded) {
        let shown = -1;
        setSend(clientId, { status: 'uploading', progress: 0 });
        p.controller = new AbortController();
        p.uploaded = await uploadChatFile(matchId, p.file, (fraction) => {
          // Every 5% is plenty; each update re-renders the bubble.
          const step = Math.floor(fraction * 20);
          if (step !== shown) {
            shown = step;
            setSend(clientId, { status: 'uploading', progress: fraction });
          }
        }, p.controller.signal);
      }
      if (!pending.current.has(clientId)) return; // discarded while uploading
      setSend(clientId, { status: 'sending' });
      const f = p.file;
      const result = await socketService.sendMessage(matchId, p.text, clientId, {
        kind: p.kind,
        replyToId: p.replyToId,
        attachment: f && p.uploaded ? {
          path: p.uploaded.path,
          mime: p.uploaded.mime,
          name: f.name,
          width: f.width,
          height: f.height,
          duration_ms: f.duration_ms,
          waveform: f.waveform,
        } : undefined,
      });
      if (result.ok) {
        pending.current.delete(clientId);
        setSend(clientId, null);
        if (mounted.current) setMessages((prev) => merge(prev, [result.message]));
        return;
      }
      // A retry of a file whose upload expired or vanished must upload again.
      if (result.error === 'upload_missing') p.uploaded = undefined;
      p.errorCode = result.error;
      setSend(clientId, { status: 'failed', error: SEND_ERRORS[result.error] ?? 'Not sent' });
    } catch (err: any) {
      if (!pending.current.has(clientId)) return;
      p.errorCode = 'upload';
      setSend(clientId, { status: 'failed', error: err?.message || 'Upload failed' });
    }
  }, [matchId, setSend]);
  const deliverRef = useRef(deliver);
  deliverRef.current = deliver;

  const addOptimistic = useCallback((clientId: string, message: Partial<ChatMessage> & { kind: ChatMessageKind }) => {
    const optimistic: ChatMessage = {
      id: `temp-${clientId}`,
      match_id: matchId,
      sender_id: myId || 'unknown',
      content: '',
      created_at: new Date().toISOString(),
      read_at: null,
      delivered_at: null,
      reactions: [],
      client_msg_id: clientId,
      ...message,
    };
    setMessages((prev) => [...prev, optimistic]);
  }, [matchId, myId]);

  const sendText = useCallback((text: string, replyTo: ChatMessage | null) => {
    const clientId = Crypto.randomUUID();
    pending.current.set(clientId, { kind: 'text', text, replyToId: replyTo?.id ?? null });
    addOptimistic(clientId, { kind: 'text', content: text, reply_to: replyTo ? replyPreviewOf(replyTo) : null });
    setFirstUnreadId(null);
    deliver(clientId);
  }, [addOptimistic, deliver]);

  /** Sends each file as its own message; the caption goes on the first. */
  const sendFiles = useCallback((files: LocalFile[], caption: string, replyTo: ChatMessage | null) => {
    files.forEach((file, i) => {
      const clientId = Crypto.randomUUID();
      const text = i === 0 && file.kind !== 'audio' ? caption : '';
      const replyToId = i === 0 ? replyTo?.id ?? null : null;
      pending.current.set(clientId, { kind: file.kind, text, replyToId, file });
      addOptimistic(clientId, {
        kind: file.kind,
        content: text,
        reply_to: i === 0 && replyTo ? replyPreviewOf(replyTo) : null,
        attachment: {
          key: clientId,
          url: null,
          local_uri: file.uri,
          mime: file.mime,
          size: file.size ?? null,
          name: file.name,
          width: file.width,
          height: file.height,
          duration_ms: file.duration_ms,
          waveform: file.waveform,
        },
      });
      deliver(clientId);
    });
    setFirstUnreadId(null);
  }, [addOptimistic, deliver]);

  const retry = useCallback((clientId: string) => { deliver(clientId); }, [deliver]);

  const discard = useCallback((clientId: string) => {
    const p = pending.current.get(clientId);
    p?.controller?.abort();
    pending.current.delete(clientId);
    setSend(clientId, null);
    setMessages((prev) => prev.filter((m) => m.id !== `temp-${clientId}`));
  }, [setSend]);

  // ── Changing sent messages ───────────────────────────────────────
  const patch = useCallback((id: string, change: Partial<ChatMessage>) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, ...change } : m)));
  }, []);

  const edit = useCallback(async (message: ChatMessage, text: string) => {
    patch(message.id, { content: text, edited_at: new Date().toISOString() });
    const res = await socketService.editMessage(message.id, text);
    if (res.ok) {
      setMessages((prev) => merge(prev, [res.message]));
    } else {
      patch(message.id, { content: message.content, edited_at: message.edited_at });
      showAlert('Could not edit', res.error === 'too_late' ? 'Messages can be edited for 15 minutes.' : SEND_ERRORS[res.error] ?? 'Try again.');
    }
  }, [patch]);

  const deleteForEveryone = useCallback(async (message: ChatMessage) => {
    patch(message.id, { deleted_at: new Date().toISOString(), content: '', attachment: null, reactions: [], reply_to: null });
    const res = await socketService.deleteForEveryone(message.id);
    if (res.ok) {
      setMessages((prev) => merge(prev, [res.message]));
    } else {
      setMessages((prev) => merge(prev, [message]));
      showAlert('Could not delete', res.error === 'too_late' ? 'Messages can be deleted for everyone for 2 days.' : SEND_ERRORS[res.error] ?? 'Try again.');
    }
  }, [patch]);

  const deleteForMe = useCallback(async (message: ChatMessage) => {
    setMessages((prev) => prev.filter((m) => m.id !== message.id));
    const res = await socketService.deleteForMe(matchId, [message.id]);
    if (!res.ok) {
      setMessages((prev) => merge(prev, [message]));
      showAlert('Could not delete', SEND_ERRORS[res.error] ?? 'Try again.');
    }
  }, [matchId]);

  const react = useCallback(async (message: ChatMessage, emoji: string | null) => {
    const others = (message.reactions ?? []).filter((r) => r.user_id !== myId);
    patch(message.id, { reactions: emoji && myId ? [...others, { user_id: myId, emoji }] : others });
    const res = await socketService.react(message.id, emoji);
    if (res.ok) patch(message.id, { reactions: res.reactions });
    else patch(message.id, { reactions: message.reactions ?? [] });
  }, [myId, patch]);

  const forward = useCallback(async (message: ChatMessage, matchIds: string[]) => {
    const res = await socketService.forward(message.id, matchIds);
    if (!res.ok) {
      showAlert('Could not forward', SEND_ERRORS[res.error] ?? 'Try again.');
      return;
    }
    // Forwarding into this same chat: show it here too.
    const here = res.messages.filter((m) => m.match_id === matchId);
    if (here.length) setMessages((prev) => merge(prev, here));
  }, [matchId]);

  // ── Typing ───────────────────────────────────────────────────────
  const typing = useRef<{ lastSent: number; idle: ReturnType<typeof setTimeout> | null }>({ lastSent: 0, idle: null });
  const notifyTyping = useCallback((active: boolean) => {
    const t = typing.current;
    if (t.idle) clearTimeout(t.idle);
    if (!active) {
      if (t.lastSent) socketService.typing(matchId, false);
      t.lastSent = 0;
      return;
    }
    const now = Date.now();
    if (now - t.lastSent > TYPING_REFRESH_MS) {
      socketService.typing(matchId, true);
      t.lastSent = now;
    }
    t.idle = setTimeout(() => {
      socketService.typing(matchId, false);
      t.lastSent = 0;
    }, TYPING_IDLE_MS);
  }, [matchId]);

  const recordingTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const notifyRecording = useCallback((active: boolean) => {
    if (recordingTimer.current) clearInterval(recordingTimer.current);
    recordingTimer.current = null;
    socketService.typing(matchId, active, 'audio');
    if (active) {
      recordingTimer.current = setInterval(() => socketService.typing(matchId, true, 'audio'), TYPING_REFRESH_MS);
    }
  }, [matchId]);

  useEffect(() => () => {
    if (typing.current.idle) clearTimeout(typing.current.idle);
    if (recordingTimer.current) clearInterval(recordingTimer.current);
  }, []);

  return {
    messages,
    loading,
    error,
    reload: () => setReloadKey((k) => k + 1),
    hasMore,
    loadingOlder,
    loadOlder,
    memberState,
    setMemberState,
    closed,
    sendStates,
    otherTyping,
    presence,
    firstUnreadId,
    sendText,
    sendFiles,
    retry,
    discard,
    edit,
    deleteForEveryone,
    deleteForMe,
    react,
    forward,
    notifyTyping,
    notifyRecording,
  };
}
