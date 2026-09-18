import {
  createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState,
  type ReactNode,
} from 'react';
import { AlertTriangle, Check, Info, Search, X } from 'lucide-react';
import { ApiError } from '../lib/api';
import { initials } from '../lib/format';

/* ── Badge ─────────────────────────────────────────────────────── */
type Tone = 'neutral' | 'ok' | 'danger' | 'warn' | 'info' | 'accent';

export function Badge({ tone = 'neutral', dot, children }: { tone?: Tone; dot?: boolean; children: ReactNode }) {
  return (
    <span className={`badge ${tone === 'neutral' ? '' : tone}`}>
      {dot && <i className="dot" />}
      {children}
    </span>
  );
}

/* ── Avatar ────────────────────────────────────────────────────── */
export function Avatar({ src, name, size }: { src?: string | null; name?: string | null; size?: 'lg' }) {
  const [broken, setBroken] = useState(false);
  const cls = `avatar${size === 'lg' ? ' lg' : ''}`;
  if (src && !broken) {
    return <img className={cls} src={src} alt="" loading="lazy" onError={() => setBroken(true)} />;
  }
  return <div className={cls} aria-hidden>{initials(name)}</div>;
}

/* ── Empty state ───────────────────────────────────────────────── */
export function Empty({ icon, title, text, action }: {
  icon?: ReactNode; title: string; text?: string; action?: ReactNode;
}) {
  return (
    <div className="empty">
      {icon && <div className="empty-icon">{icon}</div>}
      <div className="empty-title">{title}</div>
      {text && <div className="empty-text">{text}</div>}
      {action && <div style={{ marginTop: 6 }}>{action}</div>}
    </div>
  );
}

/* ── Skeleton rows ─────────────────────────────────────────────── */
/** Mirrors the table it replaces, so nothing moves when the data lands. */
export function SkeletonRows({ rows = 8, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <tbody>
      {Array.from({ length: rows }, (_, r) => (
        <tr key={r}>
          {Array.from({ length: cols }, (_, c) => (
            <td key={c}>
              <div className="sk sk-row" style={{ width: `${[70, 50, 35, 45, 30, 40, 55][c % 7]}%` }} />
            </td>
          ))}
        </tr>
      ))}
    </tbody>
  );
}

export function SkeletonBlock({ height = 120 }: { height?: number }) {
  return <div className="sk" style={{ height, borderRadius: 'var(--r-3)' }} />;
}

/* ── Error box ─────────────────────────────────────────────────── */
export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const api = error instanceof ApiError ? error : null;
  const message = error instanceof Error ? error.message : 'Something went wrong';

  return (
    <div className="empty">
      <div className="empty-icon"><AlertTriangle size={20} /></div>
      <div className="empty-title">{message}</div>
      {api?.requiredPermission && (
        <div className="empty-text">
          This needs the <code className="mono">{api.requiredPermission}</code> permission.
          Your role is <b>{api.yourRole}</b>.
        </div>
      )}
      {!!api?.fieldErrors.length && (
        <div className="empty-text">
          {api.fieldErrors.map((f) => `${f.field}: ${f.message}`).join(' · ')}
        </div>
      )}
      {onRetry && <button className="btn sm" onClick={onRetry} style={{ marginTop: 6 }}>Try again</button>}
    </div>
  );
}

/* ── Toasts ────────────────────────────────────────────────────── */
interface Toast { id: number; tone: 'ok' | 'error' | 'neutral'; title: string; detail?: string }
interface ToastApi { push: (t: Omit<Toast, 'id'>) => void; success: (t: string, d?: string) => void; error: (e: unknown) => void }

const ToastCtx = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((t: Omit<Toast, 'id'>) => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { ...t, id }]);
    setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== id)), 5200);
  }, []);

  const value = useMemo<ToastApi>(() => ({
    push,
    success: (title, detail) => push({ tone: 'ok', title, detail }),
    // The server's message verbatim: it knows why it refused, and paraphrasing
    // it here is how "Insufficient admin permission: users:delete" becomes
    // "Something went wrong".
    error: (err) => {
      const api = err instanceof ApiError ? err : null;
      const detail = api?.requiredPermission
        ? `Needs ${api.requiredPermission} — your role is ${api.yourRole}`
        : api?.fieldErrors.map((f) => `${f.field}: ${f.message}`).join(', ') || undefined;
      push({ tone: 'error', title: err instanceof Error ? err.message : 'Request failed', detail });
    },
  }), [push]);

  return (
    <ToastCtx.Provider value={value}>
      {children}
      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.tone}`} role="status">
            {t.tone === 'ok' ? <Check size={14} color="var(--ok)" />
              : t.tone === 'error' ? <AlertTriangle size={14} color="var(--danger)" />
                : <Info size={14} color="var(--fg-3)" />}
            <div className="toast-text">
              <div className="toast-title">{t.title}</div>
              {t.detail && <div className="toast-detail">{t.detail}</div>}
            </div>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
}

/* ── Modal ─────────────────────────────────────────────────────── */
export function Modal({ title, onClose, children, footer }: {
  title: string; onClose: () => void; children: ReactNode; footer?: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="modal-wrap" role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal" onClick={(e) => e.stopPropagation()}>
          <div className="modal-head"><div className="modal-title">{title}</div></div>
          <div className="modal-body">{children}</div>
          {footer && <div className="modal-foot">{footer}</div>}
        </div>
      </div>
    </>
  );
}

/* ── Confirm an action that changes someone's account ──────────── */
/**
 * One component behind every destructive action, so they cannot drift apart.
 * It names the target, states the consequence in plain words, and requires a
 * reason of the length the server will accept — because the audit log is only
 * worth having if the "why" column is populated.
 */
export function ConfirmAction({
  title, target, consequence, confirmLabel, tone = 'danger',
  minReason = 5, requireReason = true, onConfirm, onClose, extra,
}: {
  title: string;
  target: string;
  consequence: string;
  confirmLabel: string;
  tone?: 'danger' | 'primary';
  minReason?: number;
  requireReason?: boolean;
  /** Returns whatever the mutation returns; the result is not used here. */
  onConfirm: (reason: string) => Promise<unknown>;
  onClose: () => void;
  extra?: ReactNode;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { ref.current?.focus(); }, []);

  const tooShort = requireReason && reason.trim().length < minReason;

  async function submit() {
    if (tooShort || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm(reason.trim());
      onClose();
    } catch (err) {
      // Verbatim: the server's refusal is more useful than our guess at it.
      setError(err instanceof Error ? err.message : 'Request failed');
      setBusy(false);
    }
  }

  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button className={`btn ${tone}`} onClick={submit} disabled={tooShort || busy}>
            {busy ? 'Working…' : confirmLabel}
          </button>
        </>
      }
    >
      <div className={`consequence${tone === 'primary' ? ' neutral' : ''}`}>
        {tone === 'primary' ? <Info size={14} /> : <AlertTriangle size={14} />}
        <div>
          <div style={{ marginBottom: 2 }}><b>{target}</b></div>
          {consequence}
        </div>
      </div>

      {extra}

      {requireReason && (
        <div className="field">
          <label className="field-label" htmlFor={id}>Reason</label>
          <textarea
            id={id}
            ref={ref}
            className="textarea"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(); }}
            placeholder="What prompted this? Recorded in the audit log."
          />
          <div className="field-hint">
            {tooShort
              ? `At least ${minReason} characters — this is stored against your name.`
              : 'Stored in the audit log with your name and the time.'}
          </div>
        </div>
      )}

      {error && <div className="field-error">{error}</div>}
    </Modal>
  );
}

/* ── Drawer ────────────────────────────────────────────────────── */
export function Drawer({ title, subtitle, onClose, children, footer }: {
  title: ReactNode; subtitle?: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true">
        <div className="drawer-head">
          <div style={{ minWidth: 0 }}>
            <div className="panel-title truncate">{title}</div>
            {subtitle && <div className="panel-sub truncate">{subtitle}</div>}
          </div>
          <button className="btn icon sm ghost" style={{ marginLeft: 'auto' }} onClick={onClose} aria-label="Close">
            <X size={15} />
          </button>
        </div>
        <div className="drawer-body">{children}</div>
        {footer && <div className="drawer-foot">{footer}</div>}
      </aside>
    </>
  );
}

/* ── Search input ──────────────────────────────────────────────── */
export function SearchInput({ value, onChange, placeholder, width = 240 }: {
  value: string; onChange: (v: string) => void; placeholder?: string; width?: number;
}) {
  return (
    <div className="search" style={{ width }}>
      <Search size={14} />
      <input
        className="input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? 'Search'}
        spellCheck={false}
      />
    </div>
  );
}

/* ── Cursor pager ──────────────────────────────────────────────── */
/**
 * Next/back over opaque cursors. Back is a stack of the cursors already
 * visited, because a keyset cursor only goes forward — offering a page number
 * the API cannot honour would be a lie in the UI.
 */
export function useCursorPager() {
  const [cursor, setCursor] = useState<string | null>(null);
  const [stack, setStack] = useState<(string | null)[]>([]);

  return {
    cursor,
    reset: () => { setCursor(null); setStack([]); },
    next: (nextCursor: string | null) => {
      if (!nextCursor) return;
      setStack((s) => [...s, cursor]);
      setCursor(nextCursor);
    },
    back: () => {
      setStack((s) => {
        const copy = [...s];
        setCursor(copy.pop() ?? null);
        return copy;
      });
    },
    canGoBack: stack.length > 0,
    page: stack.length + 1,
  };
}

export function Pager({ pager, nextCursor, count }: {
  pager: ReturnType<typeof useCursorPager>;
  /** The API's next_cursor for the page currently on screen; null on the last page. */
  nextCursor: string | null;
  count: number;
}) {
  if (!nextCursor && !pager.canGoBack) {
    return <div className="small muted">{count} {count === 1 ? 'row' : 'rows'}</div>;
  }
  return (
    <div className="row" style={{ gap: 8, width: '100%' }}>
      <div className="small muted">Page {pager.page} · {count} rows</div>
      <div className="spacer" />
      <button className="btn sm" onClick={pager.back} disabled={!pager.canGoBack}>Back</button>
      <button className="btn sm" onClick={() => pager.next(nextCursor)} disabled={!nextCursor}>Next</button>
    </div>
  );
}
