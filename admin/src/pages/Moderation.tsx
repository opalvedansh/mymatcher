import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Ban, Check, Eye, Flag, MessageSquare, Trash2, X } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { PageBody } from '../components/Shell';
import {
  Avatar, Badge, ConfirmAction, Empty, ErrorBox, Modal, Pager, SkeletonRows, useCursorPager, useToast,
} from '../components/ui';
import { fmtDateTime, fmtRelative, shortId } from '../lib/format';
import type { DecryptedMessage, Paged, ReportAction, ReportRow } from '../lib/types';

const ACTION_COPY: Record<ReportAction, { label: string; consequence: string; danger: boolean; minReason: number }> = {
  dismiss: {
    label: 'Dismiss', danger: false, minReason: 5,
    consequence: 'Marks the report dismissed. Nothing happens to the content or the account.',
  },
  delete_content: {
    label: 'Delete the content', danger: true, minReason: 5,
    consequence: 'Removes the reported post or story and its uploaded file. A reported message has its text replaced, so the conversation keeps its shape.',
  },
  ban_target: {
    label: 'Ban the reported user', danger: true, minReason: 5,
    consequence: 'Ends their sessions, removes them from every feed, and stops their profile resolving.',
  },
  ban_reporter: {
    label: 'Ban the reporter', danger: true, minReason: 5,
    consequence: 'For someone abusing the report button. Ends their sessions and removes them from feeds.',
  },
  warn_target: {
    label: 'Warn the user', danger: false, minReason: 10,
    consequence: 'Sends them an in-app notice containing exactly the reason you type below. They will read it.',
  },
  actioned_no_change: {
    label: 'Mark handled', danger: false, minReason: 5,
    consequence: 'Marks the report actioned without changing anything — for when you dealt with it elsewhere.',
  },
};

export default function Moderation() {
  const { can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const pager = useCursorPager();

  const [status, setStatus] = useState('open');
  const [targetType, setTargetType] = useState('');
  const [cursorIdx, setCursorIdx] = useState(0);
  const [pending, setPending] = useState<{ report: ReportRow; action: ReportAction } | null>(null);
  const [bulkAction, setBulkAction] = useState<ReportAction | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [context, setContext] = useState<ReportRow | null>(null);

  const query = { status: status || undefined, target_type: targetType || undefined, cursor: pager.cursor || undefined, limit: 50 };
  const list = useQuery({
    queryKey: ['reports', query],
    queryFn: () => api.get<Paged<ReportRow>>('/reports', query),
  });
  const rows = list.data?.data ?? [];

  useEffect(() => { pager.reset(); setSelected(new Set()); setCursorIdx(0); },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [status, targetType]);

  const act = useMutation({
    mutationFn: ({ id, action, reason }: { id: string; action: ReportAction; reason: string }) =>
      api.post<{ effects: { type: string; applied: boolean }[] }>(`/reports/${id}/action`, { action, reason }),
    onSuccess: (res) => {
      const applied = res.effects.filter((e) => e.applied).map((e) => e.type.replace(/_/g, ' '));
      toast.success('Report actioned', applied.length ? applied.join(', ') : undefined);
      qc.invalidateQueries({ queryKey: ['reports'] });
      qc.invalidateQueries({ queryKey: ['stats'] });
    },
    onError: toast.error,
  });

  const bulk = useMutation({
    mutationFn: ({ action, reason }: { action: ReportAction; reason: string }) =>
      api.post<{ affected: number; failed: unknown[] }>('/reports/bulk', {
        report_ids: [...selected], action, reason,
      }),
    onSuccess: (res) => {
      toast.success(`${res.affected} reports actioned`, res.failed.length ? `${res.failed.length} failed` : undefined);
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ['reports'] });
      qc.invalidateQueries({ queryKey: ['stats'] });
    },
    onError: toast.error,
  });

  // Keyboard triage. A moderation queue is worked with both hands on the
  // keyboard, not by aiming at buttons.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (pending || bulkAction || context) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const row = rows[cursorIdx];

      if (e.key === 'j') { e.preventDefault(); setCursorIdx((i) => Math.min(i + 1, rows.length - 1)); }
      if (e.key === 'k') { e.preventDefault(); setCursorIdx((i) => Math.max(i - 1, 0)); }
      if (!row || !can('reports:write')) return;
      if (e.key === 'd') { e.preventDefault(); setPending({ report: row, action: 'dismiss' }); }
      if (e.key === 'a') { e.preventDefault(); setPending({ report: row, action: 'delete_content' }); }
      if (e.key === 'b') { e.preventDefault(); setPending({ report: row, action: 'ban_target' }); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [rows, cursorIdx, pending, bulkAction, context, can]);

  return (
    <PageBody wide>
      <div className="stack">
        <div className="panel">
          <div className="panel-head">
            <select className="select" style={{ width: 140 }} value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="open">Open</option>
              <option value="actioned">Actioned</option>
              <option value="dismissed">Dismissed</option>
              <option value="">All</option>
            </select>
            <select className="select" style={{ width: 140 }} value={targetType} onChange={(e) => setTargetType(e.target.value)}>
              <option value="">Any target</option>
              <option value="user">Users</option>
              <option value="post">Posts</option>
              <option value="story">Stories</option>
              <option value="message">Messages</option>
            </select>
            <div className="panel-actions">
              <span className="tiny muted">
                <kbd>J</kbd> <kbd>K</kbd> move · <kbd>D</kbd> dismiss · <kbd>A</kbd> delete · <kbd>B</kbd> ban
              </span>
            </div>
          </div>

          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  {can('reports:write') && <th style={{ width: 34 }} />}
                  <th style={{ width: 150 }}>Reason</th>
                  <th>Reported content</th>
                  <th style={{ width: 170 }}>Reporter</th>
                  <th style={{ width: 90 }}>Status</th>
                  <th style={{ width: 110 }}>Filed</th>
                  <th style={{ width: 220 }} />
                </tr>
              </thead>

              {list.isLoading ? <SkeletonRows rows={8} cols={7} /> : (
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={r.id} className={i === cursorIdx ? 'selected' : ''} onClick={() => setCursorIdx(i)}>
                      {can('reports:write') && (
                        <td onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox" style={{ accentColor: 'var(--accent)' }}
                            checked={selected.has(r.id)}
                            aria-label="Select report"
                            onChange={() => setSelected((prev) => {
                              const n = new Set(prev);
                              if (n.has(r.id)) n.delete(r.id); else n.add(r.id);
                              return n;
                            })}
                          />
                        </td>
                      )}
                      <td>
                        <div className="row" style={{ gap: 6 }}>
                          <Badge tone={r.reason === 'harassment' ? 'danger' : 'warn'}>{r.reason.replace('_', ' ')}</Badge>
                        </div>
                        {(r.prior_reports_against_target ?? 0) > 0 && (
                          <div className="tiny" style={{ color: 'var(--danger)', marginTop: 3 }}>
                            {r.prior_reports_against_target} prior
                          </div>
                        )}
                      </td>
                      <td className="wrap"><TargetCell report={r} onReadContext={() => setContext(r)} canRead={can('reports:write')} /></td>
                      <td>
                        {r.reporter ? (
                          <div className="cell-name">
                            <Avatar src={r.reporter.avatar_url} name={r.reporter.name} />
                            <span className="truncate">{r.reporter.name ?? shortId(r.reporter.id)}</span>
                          </div>
                        ) : <span className="muted">Deleted</span>}
                      </td>
                      <td>
                        <Badge tone={r.status === 'open' ? 'warn' : r.status === 'actioned' ? 'ok' : 'neutral'}>
                          {r.status}
                        </Badge>
                      </td>
                      <td className="muted" title={fmtDateTime(r.created_at)}>{fmtRelative(r.created_at)}</td>
                      <td>
                        {can('reports:write') && r.status === 'open' && (
                          <div className="btn-row" style={{ justifyContent: 'flex-end' }}>
                            <button className="btn sm ghost" onClick={() => setPending({ report: r, action: 'dismiss' })}>
                              <X size={13} /> Dismiss
                            </button>
                            {r.target_type !== 'user' && (
                              <button className="btn sm danger" onClick={() => setPending({ report: r, action: 'delete_content' })}>
                                <Trash2 size={13} /> Delete
                              </button>
                            )}
                            {r.target_type === 'user' && (
                              <button className="btn sm danger" onClick={() => setPending({ report: r, action: 'ban_target' })}>
                                <Ban size={13} /> Ban
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              )}
            </table>

            {list.isError && <ErrorBox error={list.error} onRetry={() => list.refetch()} />}
            {!list.isLoading && !list.isError && rows.length === 0 && (
              <Empty
                icon={<Flag size={22} />}
                title={status === 'open' ? 'No open reports' : 'Nothing here'}
                text={status === 'open'
                  ? 'The queue is clear. Switch the filter to see what has already been handled.'
                  : 'No reports match this filter.'}
                action={status === 'open'
                  ? <button className="btn sm" onClick={() => setStatus('actioned')}>See actioned reports</button>
                  : undefined}
              />
            )}
          </div>

          {selected.size > 0 && (
            <div className="bulkbar">
              <b>{selected.size} selected</b>
              <button className="btn sm ghost" onClick={() => setSelected(new Set())}>Clear</button>
              <div className="spacer" />
              <button className="btn sm" onClick={() => setBulkAction('dismiss')}>Dismiss all</button>
              <button className="btn sm danger" onClick={() => setBulkAction('ban_target')}>Ban all targets</button>
            </div>
          )}

          <div className="panel-head" style={{ borderTop: '1px solid var(--line)', borderBottom: 'none' }}>
            <Pager pager={pager} nextCursor={list.data?.next_cursor ?? null} count={rows.length} />
          </div>
        </div>
      </div>

      {pending && (
        <ConfirmAction
          title={ACTION_COPY[pending.action].label}
          target={describeTarget(pending.report)}
          consequence={ACTION_COPY[pending.action].consequence}
          confirmLabel={ACTION_COPY[pending.action].label}
          tone={ACTION_COPY[pending.action].danger ? 'danger' : 'primary'}
          minReason={ACTION_COPY[pending.action].minReason}
          onConfirm={(reason) => act.mutateAsync({ id: pending.report.id, action: pending.action, reason })}
          onClose={() => setPending(null)}
          extra={
            <div className="field">
              <div className="field-label">Other actions</div>
              <select
                className="select"
                value={pending.action}
                onChange={(e) => setPending({ ...pending, action: e.target.value as ReportAction })}
              >
                {(Object.keys(ACTION_COPY) as ReportAction[]).map((a) => (
                  <option key={a} value={a}>{ACTION_COPY[a].label}</option>
                ))}
              </select>
            </div>
          }
        />
      )}

      {bulkAction && (
        <ConfirmAction
          title={`${ACTION_COPY[bulkAction].label} — ${selected.size} reports`}
          target={`${selected.size} selected reports`}
          consequence={ACTION_COPY[bulkAction].consequence}
          confirmLabel={`Apply to ${selected.size}`}
          tone={ACTION_COPY[bulkAction].danger ? 'danger' : 'primary'}
          minReason={ACTION_COPY[bulkAction].minReason}
          onConfirm={(reason) => bulk.mutateAsync({ action: bulkAction, reason })}
          onClose={() => setBulkAction(null)}
        />
      )}

      {context && <MessageContext report={context} onClose={() => setContext(null)} />}
    </PageBody>
  );
}

function describeTarget(r: ReportRow): string {
  const t = r.target as Record<string, unknown> | undefined;
  if (!t || t.deleted) return `${r.target_type} ${shortId(r.target_id)} (already removed)`;
  if (r.target_type === 'user') return `${(t.name as string) ?? 'user'} · ${r.target_id}`;
  return `${r.target_type} ${shortId(r.target_id)}`;
}

function TargetCell({ report, onReadContext, canRead }: {
  report: ReportRow; onReadContext: () => void; canRead: boolean;
}) {
  const t = report.target as Record<string, unknown> | undefined;

  if (!t || t.deleted) {
    return <span className="muted"><Trash2 size={12} style={{ verticalAlign: -2 }} /> Content already removed</span>;
  }

  if (report.target_type === 'user') {
    return (
      <div className="cell-name">
        <Avatar src={t.avatar_url as string} name={t.name as string} />
        <div style={{ minWidth: 0 }}>
          <div className="truncate">
            {(t.name as string) || 'No name'}
            {(t.banned as boolean) && <Badge tone="danger">Already banned</Badge>}
          </div>
          {!!t.bio && <div className="tiny muted truncate" style={{ maxWidth: 320 }}>{t.bio as string}</div>}
        </div>
      </div>
    );
  }

  if (report.target_type === 'post' || report.target_type === 'story') {
    const url = (t.image_url ?? t.media_url) as string;
    return (
      <div className="cell-name">
        <img src={url} alt="" className="avatar" style={{ borderRadius: 'var(--r-1)', width: 34, height: 34 }} loading="lazy" />
        <div style={{ minWidth: 0 }}>
          <div className="truncate" style={{ maxWidth: 280 }}>{(t.caption as string) || <span className="muted">No caption</span>}</div>
          <a className="tiny" href={url} target="_blank" rel="noreferrer noopener" style={{ color: 'var(--info)' }}>Open media</a>
          {(t.expired as boolean) && <Badge>Expired</Badge>}
        </div>
      </div>
    );
  }

  // A message. Content is deliberately absent from the queue — reading it is a
  // separate, audited, rate-limited act.
  return (
    <div className="row" style={{ gap: 8 }}>
      <MessageSquare size={14} className="muted" />
      <span className="muted">Message, content hidden</span>
      {canRead && (
        <button className="btn sm ghost" onClick={onReadContext}>
          <Eye size={13} /> Read in context
        </button>
      )}
    </div>
  );
}

/**
 * The reported message plus five either side. Reading this writes an audit row
 * naming every message id revealed, and the operator is told so before they
 * open it — not in a footnote afterwards.
 */
function MessageContext({ report, onClose }: { report: ReportRow; onClose: () => void }) {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['message-context', report.id],
    queryFn: () => api.get<{ messages: DecryptedMessage[]; window: number }>(`/reports/${report.id}/message-context`),
    retry: false,
  });

  return (
    <Modal title="Reported message, in context" onClose={onClose}
      footer={<button className="btn" onClick={onClose}>Close</button>}>
      <div className="consequence neutral">
        <AlertTriangle size={14} />
        <div>
          These are private messages. Opening this recorded your name, the reason and every message id shown, in the audit log.
        </div>
      </div>

      {isLoading && <div className="sk" style={{ height: 120 }} />}
      {isError && <ErrorBox error={error} />}

      {data && (
        <div className="stack" style={{ gap: 6 }}>
          {data.messages.map((m) => (
            <div
              key={m.id}
              style={{
                padding: '7px 9px',
                borderRadius: 'var(--r-2)',
                background: m.is_target ? 'var(--danger-dim)' : 'var(--panel-2)',
                border: m.is_target ? '1px solid rgba(240,80,58,0.3)' : '1px solid transparent',
              }}
            >
              <div className="tiny muted" style={{ marginBottom: 2 }}>
                {shortId(m.sender_id, 10)} · {fmtDateTime(m.created_at)}
                {m.is_target && <b style={{ color: 'var(--danger)' }}> · reported</b>}
              </div>
              <div style={{ fontSize: 12.5 }}>{m.content}</div>
            </div>
          ))}
          <div className="tiny muted">
            <Check size={11} style={{ verticalAlign: -1 }} /> Showing the reported message and up to {data.window} either side.
          </div>
        </div>
      )}
    </Modal>
  );
}
