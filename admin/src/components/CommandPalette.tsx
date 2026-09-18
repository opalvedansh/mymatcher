import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, User } from 'lucide-react';

interface NavItem { to: string; label: string; group: string; icon: ReactNode }

/**
 * ⌘K. Two jobs: jump to a section, and open a user by id or email without
 * going through the list first — which is what support actually does when
 * someone pastes an id into a ticket.
 */
export function CommandPalette({ items, onClose, onNavigate }: {
  items: NavItem[];
  onClose: () => void;
  onNavigate: (to: string) => void;
}) {
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  useEffect(() => { inputRef.current?.focus(); }, []);

  const results = useMemo(() => {
    const term = q.trim().toLowerCase();
    const nav = items
      .filter((i) => !term || i.label.toLowerCase().includes(term) || i.group.toLowerCase().includes(term))
      .map((i) => ({ kind: 'nav' as const, ...i }));

    // A pasted uuid, a Supabase uid or an email is almost certainly a user.
    const looksLikeUser = term.length > 3 && (term.includes('@') || /^[0-9a-f-]{8,}$/i.test(term));
    if (looksLikeUser) {
      return [
        {
          kind: 'user' as const,
          to: term.includes('@') ? `/users?search=${encodeURIComponent(q.trim())}` : `/users/${q.trim()}`,
          label: term.includes('@') ? `Search users for "${q.trim()}"` : `Open user ${q.trim()}`,
          group: 'People',
          icon: <User size={15} />,
        },
        ...nav,
      ];
    }
    return nav;
  }, [q, items]);

  useEffect(() => { setActive(0); }, [q]);

  function go(index: number) {
    const item = results[index];
    if (!item) return;
    if (item.kind === 'user') {
      navigate(item.to);
      onClose();
      return;
    }
    onNavigate(item.to);
  }

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="cmdk-wrap" role="dialog" aria-modal="true" aria-label="Jump to">
        <div className="cmdk" onClick={(e) => e.stopPropagation()}>
          <input
            ref={inputRef}
            className="cmdk-input"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Jump to a section, or paste a user id or email"
            spellCheck={false}
            onKeyDown={(e) => {
              if (e.key === 'Escape') return onClose();
              if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)); }
              if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
              if (e.key === 'Enter') { e.preventDefault(); go(active); }
            }}
          />
          <div className="cmdk-list">
            {results.length === 0 && (
              <div className="cmdk-item" style={{ color: 'var(--fg-3)', cursor: 'default' }}>No match</div>
            )}
            {results.map((r, i) => (
              <div
                key={`${r.kind}-${r.to}`}
                className={`cmdk-item${i === active ? ' active' : ''}`}
                onMouseEnter={() => setActive(i)}
                onClick={() => go(i)}
              >
                {r.icon}
                {r.label}
                {i === active && <ArrowRight size={13} style={{ marginLeft: 'auto' }} />}
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
