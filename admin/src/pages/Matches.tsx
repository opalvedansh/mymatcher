import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Eye, Lock, MessagesSquare } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { PageBody } from '../components/Shell';
import {
  Badge, Drawer, Empty, ErrorBox, Modal, Pager, SkeletonRows, useCursorPager,
} from '../components/ui';
import { fmtDate, fmtDateTime, fmtNum, fmtRelative, shortId } from '../lib/format';
import type { DecryptedMessage, MatchRow, Paged, TimelineEntry } from '../lib/types';

export default function Matches() {
  const pager = useCursorPager();
  const [status, setStatus] = useState('');
  const [open, setOpen] = useState<MatchRow | null>(null);

  const query = { status: status || undefined, cursor: pager.cursor || undefined, limit: 50 };
  const list = useQuery({
    queryKey: ['matches', query],
    queryFn: () => api.get<Paged<MatchRow>>('/matches', query),
  });
  const rows = list.data?.data ?? [];

  return (
    <PageBody wide>
      <div className="stack">
        <div className="panel">
          <div className="panel-head">
            <select className="select" style={{ width: 150 }} value={status}
              onChange={(e) => { setStatus(e.target.value); pager.reset(); }}>
              <option value="">Any status</option>
              <option value="active">Active</option>
              <option value="archived">Archived</option>
            </select>
            <div className="panel-actions">
              <span className="tiny muted">
                <Lock size={11} style={{ verticalAlign: -1 }} /> Message content is not shown here
              </span>
            </div>
          </div>

          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Brand</th>
                  <th>Creator</th>
                  <th>Status</th>
                  <th className="num">Messages</th>
                  <th>Last message</th>
                  <th>Matched</th>
                  <th style={{ width: 60 }} />
                </tr>
              </thead>
              {list.isLoading ? <SkeletonRows rows={10} cols={7} /> : (
                <tbody>
                  {rows.map((m) => (
                    <tr key={m.id} className="clickable" onClick={() => setOpen(m)}>
                      <td className="truncate" style={{ maxWidth: 220 }}>{m.brand_name ?? shortId(m.brand_id)}</td>
                      <td className="truncate" style={{ maxWidth: 220 }}>{m.influencer_name ?? shortId(m.influencer_id)}</td>
                      <td>
                        <div className="row" style={{ gap: 5 }}>
                          <Badge tone={m.status === 'active' ? 'ok' : 'neutral'}>{m.status}</Badge>
                          {m.reported && <Badge tone="danger">Reported</Badge>}
                        </div>
                      </td>
                      <td className="num">{fmtNum(m.message_count)}</td>
                      <td className="muted">{m.last_message_at ? fmtRelative(m.last_message_at) : 'Never'}</td>
                      <td className="muted">{fmtDate(m.matched_at)}</td>
                      <td><span className="cell-id">{shortId(m.id, 6)}</span></td>
                    </tr>
                  ))}
                </tbody>
              )}
            </table>

            {list.isError && <ErrorBox error={list.error} onRetry={() => list.refetch()} />}
            {!list.isLoading && rows.length === 0 && (
              <Empty icon={<MessagesSquare size={22} />} title="No matches" text="Nobody has matched yet." />
            )}
          </div>

          <div className="panel-head" style={{ borderTop: '1px solid var(--line)', borderBottom: 'none' }}>
            <Pager pager={pager} nextCursor={list.data?.next_cursor ?? null} count={rows.length} />
          </div>
        </div>
      </div>

      {open && <MatchDrawer match={open} onClose={() => setOpen(null)} />}
    </PageBody>
  );
}

function MatchDrawer({ match, onClose }: { match: MatchRow; onClose: () => void }) {
  const { can } = useAuth();
  const [reading, setReading] = useState(false);

  const timeline = useQuery({
    queryKey: ['timeline', match.id],
    queryFn: () => api.get<Paged<TimelineEntry>>(`/matches/${match.id}/timeline`, { limit: 200 }),
  });

  const entries = [...(timeline.data?.data ?? [])].reverse();
  const maxLen = Math.max(1, ...entries.map((e) => e.cipher_length));

  return (
    <Drawer
      title={`${match.brand_name ?? 'Brand'} ↔ ${match.influencer_name ?? 'Creator'}`}
      subtitle={`${fmtNum(match.message_count)} messages · matched ${fmtDate(match.matched_at)}`}
      onClose={onClose}
      footer={
        can('messages:read') ? (
          <button className="btn danger" onClick={() => setReading(true)}>
            <Eye size={14} /> Read the conversation
          </button>
        ) : (
          <div className="tiny muted row" style={{ gap: 6 }}>
            <Lock size={12} /> Reading conversations needs the messages:read permission.
          </div>
        )
      }
    >
      <div className="stack">
        <div className="consequence neutral">
          <Lock size={14} />
          <div>
            Messages are encrypted at rest. This view shows the shape of the conversation — who sent what, when,
            and how long — with none of its text.
          </div>
        </div>

        <dl className="kv">
          <dt>Brand</dt><dd className="mono">{match.brand_id}</dd>
          <dt>Creator</dt><dd className="mono">{match.influencer_id}</dd>
          <dt>Status</dt><dd>{match.status}</dd>
          <dt>Relevance</dt><dd>{match.relevance_score ?? '—'}</dd>
          <dt>Last message</dt><dd>{match.last_message_at ? fmtDateTime(match.last_message_at) : 'Never'}</dd>
        </dl>

        <div className="panel">
          <div className="panel-head"><div className="panel-title">Timeline</div>
            <div className="panel-sub">{entries.length} messages</div></div>
          <div className="panel-body">
            {timeline.isLoading && <div className="sk" style={{ height: 120 }} />}
            {timeline.isError && <ErrorBox error={timeline.error} />}
            {entries.length === 0 && !timeline.isLoading && (
              <div className="small muted">Nobody has sent a message in this match.</div>
            )}
            <div className="stack" style={{ gap: 5 }}>
              {entries.map((e) => {
                const fromBrand = e.sender_id === match.brand_id;
                return (
                  <div key={e.id} className="row" style={{ gap: 8 }}>
                    <span className="tiny muted" style={{ width: 96, flex: '0 0 auto' }}>
                      {fmtRelative(e.created_at)}
                    </span>
                    <span className="tiny" style={{ width: 54, flex: '0 0 auto', color: fromBrand ? 'var(--series-1)' : 'var(--series-2)' }}>
                      {fromBrand ? 'Brand' : 'Creator'}
                    </span>
                    <div className="bar-mini" style={{ flex: 1 }}>
                      <div style={{
                        width: `${(e.cipher_length / maxLen) * 100}%`,
                        background: fromBrand ? 'var(--series-1)' : 'var(--series-2)',
                      }} />
                    </div>
                    {!e.read_at && <span className="tiny muted" style={{ width: 44 }}>unread</span>}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {reading && <ReadThread match={match} onClose={() => setReading(false)} />}
    </Drawer>
  );
}

/**
 * The full decrypted thread. Superadmin only, a written reason required, and
 * the audit row is written before a byte is decrypted — so the reason field is
 * a gate here, not a formality.
 */
function ReadThread({ match, onClose }: { match: MatchRow; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const [submitted, setSubmitted] = useState<string | null>(null);

  const thread = useQuery({
    queryKey: ['thread', match.id, submitted],
    queryFn: () => api.get<{ data: DecryptedMessage[] }>(`/matches/${match.id}/messages`, { reason: submitted, limit: 200 }),
    enabled: !!submitted,
    retry: false,
    staleTime: 0,
  });

  if (!submitted) {
    return (
      <Modal
        title="Read this conversation"
        onClose={onClose}
        footer={
          <>
            <button className="btn ghost" onClick={onClose}>Cancel</button>
            <button className="btn danger" disabled={reason.trim().length < 10} onClick={() => setSubmitted(reason.trim())}>
              Read the conversation
            </button>
          </>
        }
      >
        <div className="consequence">
          <AlertTriangle size={14} />
          <div>
            You are about to read two people's private messages. Your name, this reason and the id of every message
            shown will be written to the audit log <b>before</b> anything is decrypted, and this is limited to ten
            reads an hour.
          </div>
        </div>
        <div className="field">
          <label className="field-label" htmlFor="read-reason">Why do you need to read this?</label>
          <textarea id="read-reason" className="textarea" value={reason} autoFocus
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Investigating report #1234 — alleged threats not visible in the reported message alone" />
          <div className="field-hint">
            {reason.trim().length < 10 ? 'At least 10 characters.' : 'Stored word for word against your name.'}
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="Conversation" onClose={onClose} footer={<button className="btn" onClick={onClose}>Close</button>}>
      {thread.isLoading && <div className="sk" style={{ height: 160 }} />}
      {thread.isError && <ErrorBox error={thread.error} />}
      {thread.data && (
        <div className="stack" style={{ gap: 6, maxHeight: '52vh', overflowY: 'auto' }}>
          {[...thread.data.data].reverse().map((m) => {
            const fromBrand = m.sender_id === match.brand_id;
            return (
              <div key={m.id} style={{
                padding: '7px 9px', borderRadius: 'var(--r-2)', background: 'var(--panel-2)',
                borderLeft: `2px solid ${fromBrand ? 'var(--series-1)' : 'var(--series-2)'}`,
              }}>
                <div className="tiny muted" style={{ marginBottom: 2 }}>
                  {fromBrand ? match.brand_name ?? 'Brand' : match.influencer_name ?? 'Creator'} · {fmtDateTime(m.created_at)}
                </div>
                <div style={{ fontSize: 12.5 }}>{m.content}</div>
              </div>
            );
          })}
        </div>
      )}
    </Modal>
  );
}
