import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Check, ExternalLink, ShieldCheck, X } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { PageBody } from '../components/Shell';
import { Avatar, Badge, ConfirmAction, Empty, ErrorBox, Pager, SkeletonBlock, useCursorPager, useToast } from '../components/ui';
import { fmtDate, fmtDateTime, fmtRelative } from '../lib/format';
import type { Paged, VerificationRow, VerificationStatus } from '../lib/types';

export default function Verifications() {
  const { can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const pager = useCursorPager();

  const [status, setStatus] = useState<VerificationStatus>('pending');
  const [selected, setSelected] = useState<string | null>(null);
  const [decision, setDecision] = useState<{ row: VerificationRow; status: VerificationStatus } | null>(null);

  const query = { status, cursor: pager.cursor || undefined, limit: 50 };
  const list = useQuery({
    queryKey: ['verifications', query],
    queryFn: () => api.get<Paged<VerificationRow>>('/verifications', query),
  });

  const rows = list.data?.data ?? [];
  const active = rows.find((r) => r.user_id === selected) ?? rows[0];

  const review = useMutation({
    mutationFn: ({ userId, next, note }: { userId: string; next: VerificationStatus; note: string }) =>
      api.put(`/verifications/${userId}`, { status: next, note, reason: note }),
    onSuccess: (_r, vars) => {
      toast.success(
        vars.next === 'approved' ? 'Verified' : 'Rejected',
        vars.next === 'approved' ? 'The badge is live and they have been notified.' : 'They have been notified.',
      );
      qc.invalidateQueries({ queryKey: ['verifications'] });
      qc.invalidateQueries({ queryKey: ['stats'] });
      setSelected(null);
    },
    onError: toast.error,
  });

  return (
    <PageBody wide>
      <div className="stack">
        <div className="row">
          <div className="tabs" style={{ border: 'none' }}>
            {(['pending', 'approved', 'rejected', 'none'] as VerificationStatus[]).map((s) => (
              <button key={s} className={`tab${status === s ? ' active' : ''}`}
                onClick={() => { setStatus(s); pager.reset(); setSelected(null); }}>
                {s === 'none' ? 'Not requested' : s[0].toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {list.isLoading && <SkeletonBlock height={280} />}
        {list.isError && <ErrorBox error={list.error} onRetry={() => list.refetch()} />}

        {!list.isLoading && rows.length === 0 && (
          <div className="panel">
            <Empty
              icon={<ShieldCheck size={22} />}
              title={status === 'pending' ? 'No businesses waiting' : 'Nothing here'}
              text={status === 'pending'
                ? 'Every submitted verification has been decided.'
                : 'No brands have this status.'}
            />
          </div>
        )}

        {rows.length > 0 && (
          <div className="grid" style={{ gridTemplateColumns: 'minmax(280px, 380px) 1fr' }}>
            {/* The queue */}
            <div className="panel" style={{ alignSelf: 'start' }}>
              <div className="panel-head"><div className="panel-title">{rows.length} in queue</div></div>
              <div className="tbl-wrap">
                <table className="tbl">
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.user_id}
                        className={`clickable${active?.user_id === r.user_id ? ' selected' : ''}`}
                        onClick={() => setSelected(r.user_id)}>
                        <td>
                          <div className="cell-name">
                            <Avatar src={r.logo_url} name={r.name} />
                            <div style={{ minWidth: 0 }}>
                              <div className="truncate">{r.verification_business_name || r.name || 'Unnamed'}</div>
                              <div className="tiny muted truncate">{fmtRelative(r.verification_submitted_at)}</div>
                            </div>
                          </div>
                        </td>
                        <td className="right">
                          {r.report_count > 0 && <Badge tone="danger">{r.report_count} reports</Badge>}
                          {r.banned && <Badge tone="danger">Banned</Badge>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="panel-head" style={{ borderTop: '1px solid var(--line)', borderBottom: 'none' }}>
                <Pager pager={pager} nextCursor={list.data?.next_cursor ?? null} count={rows.length} />
              </div>
            </div>

            {/* The evidence, beside the profile it belongs to */}
            {active && (
              <div className="panel">
                <div className="panel-head">
                  <Avatar src={active.logo_url} name={active.name} />
                  <div style={{ minWidth: 0 }}>
                    <div className="panel-title truncate">{active.name || 'Unnamed brand'}</div>
                    <div className="panel-sub truncate">{active.email}</div>
                  </div>
                  <div className="panel-actions">
                    {active.banned && <Badge tone="danger" dot>Banned</Badge>}
                    <Badge tone={active.verification_status === 'approved' ? 'ok' : active.verification_status === 'pending' ? 'warn' : 'neutral'}>
                      {active.verification_status}
                    </Badge>
                  </div>
                </div>

                <div className="panel-body stack">
                  <div className="grid c2">
                    <div>
                      <div className="stat-label" style={{ marginBottom: 7 }}>What they submitted</div>
                      <dl className="kv" style={{ gridTemplateColumns: '120px 1fr' }}>
                        <dt>Business name</dt>
                        <dd>{active.verification_business_name || <span className="muted">—</span>}</dd>
                        <dt>Registration no.</dt>
                        <dd className="mono">{active.verification_reg_number || <span className="muted">—</span>}</dd>
                        <dt>Submitted</dt>
                        <dd>{fmtDateTime(active.verification_submitted_at)}</dd>
                        {active.verification_reviewed_at && (
                          <>
                            <dt>Last decided</dt>
                            <dd>{fmtDateTime(active.verification_reviewed_at)}<br />
                              <span className="tiny muted">by {active.verification_reviewed_by ?? 'unknown'}</span></dd>
                          </>
                        )}
                      </dl>
                    </div>

                    <div>
                      <div className="stat-label" style={{ marginBottom: 7 }}>What the profile says</div>
                      <dl className="kv" style={{ gridTemplateColumns: '120px 1fr' }}>
                        <dt>Profile name</dt><dd>{active.name || <span className="muted">—</span>}</dd>
                        <dt>Website</dt>
                        <dd>
                          {active.website
                            ? <a href={active.website} target="_blank" rel="noreferrer noopener" style={{ color: 'var(--info)' }}>
                              {active.website} <ExternalLink size={11} style={{ verticalAlign: -1 }} />
                            </a>
                            : <span className="muted">None given</span>}
                        </dd>
                        <dt>Location</dt><dd>{active.location || <span className="muted">—</span>}</dd>
                        <dt>Categories</dt>
                        <dd>{active.categories?.length
                          ? <div className="row wrap" style={{ gap: 4 }}>{active.categories.map((c) => <Badge key={c}>{c}</Badge>)}</div>
                          : <span className="muted">—</span>}</dd>
                        <dt>Account age</dt><dd>{fmtDate(active.user_created_at)}</dd>
                      </dl>
                    </div>
                  </div>

                  {active.bio && (
                    <div>
                      <div className="stat-label" style={{ marginBottom: 5 }}>Bio</div>
                      <div className="small">{active.bio}</div>
                    </div>
                  )}

                  {active.verification_note && (
                    <div className="consequence neutral">
                      <Building2 size={14} />
                      <div><b>Previous note</b><div>{active.verification_note}</div></div>
                    </div>
                  )}

                  {can('verifications:write') && (
                    <div className="btn-row" style={{ paddingTop: 4 }}>
                      <button className="btn primary" onClick={() => setDecision({ row: active, status: 'approved' })}>
                        <Check size={14} /> Approve and grant the badge
                      </button>
                      <button className="btn danger" onClick={() => setDecision({ row: active, status: 'rejected' })}>
                        <X size={14} /> Reject
                      </button>
                      {active.verification_status !== 'pending' && (
                        <button className="btn ghost" onClick={() => setDecision({ row: active, status: 'pending' })}>
                          Put back in the queue
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {decision && (
        <ConfirmAction
          title={decision.status === 'approved' ? 'Approve this business'
            : decision.status === 'rejected' ? 'Reject this request' : 'Return to the queue'}
          target={decision.row.verification_business_name || decision.row.name || decision.row.email}
          consequence={decision.status === 'approved'
            ? 'The verified badge goes live on their profile immediately and they get an in-app notice.'
            : decision.status === 'rejected'
              ? 'Any existing badge is removed. Your note below is sent to them word for word, so write it for them to read.'
              : 'Clears the decision and puts them back in the pending queue.'}
          confirmLabel={decision.status === 'approved' ? 'Approve' : decision.status === 'rejected' ? 'Reject' : 'Return to queue'}
          tone={decision.status === 'rejected' ? 'danger' : 'primary'}
          minReason={decision.status === 'rejected' ? 10 : 5}
          onConfirm={(note) => review.mutateAsync({ userId: decision.row.user_id, next: decision.status, note })}
          onClose={() => setDecision(null)}
        />
      )}
    </PageBody>
  );
}
