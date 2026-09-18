import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, Send, Users } from 'lucide-react';
import { api } from '../lib/api';
import { PageBody } from '../components/Shell';
import { Badge, ConfirmAction, Empty, ErrorBox, SkeletonBlock, useToast } from '../components/ui';
import { fmtDateTime, fmtNum } from '../lib/format';
import type { BroadcastPreview, BroadcastRow, BroadcastSegment, Paged } from '../lib/types';

export default function Broadcast() {
  const toast = useToast();
  const qc = useQueryClient();

  const [segment, setSegment] = useState<BroadcastSegment>({});
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [confirming, setConfirming] = useState(false);
  // Regenerated per composed message so a retried POST is a 409, not a second
  // push to everybody.
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  const preview = useQuery({
    queryKey: ['broadcast-preview', segment],
    queryFn: () => api.post<BroadcastPreview>('/broadcast/preview', { segment }),
  });

  const history = useQuery({
    queryKey: ['broadcasts'],
    queryFn: () => api.get<Paged<BroadcastRow>>('/broadcast', { limit: 15 }),
  });

  const send = useMutation({
    mutationFn: () => api.post<{ recipients: number }>('/broadcast', {
      segment, title: title.trim(), body: body.trim(), idempotency_key: idempotencyKey,
    }),
    onSuccess: (res) => {
      toast.success(`Sent to ${fmtNum(res.recipients)} people`);
      setTitle('');
      setBody('');
      qc.invalidateQueries({ queryKey: ['broadcasts'] });
    },
    onError: toast.error,
  });

  const ready = title.trim().length > 0 && body.trim().length > 0 && (preview.data?.recipients ?? 0) > 0;

  function setSeg<K extends keyof BroadcastSegment>(key: K, value: BroadcastSegment[K] | '') {
    setSegment((s) => {
      const next = { ...s };
      if (value === '' || value === undefined) delete next[key];
      else next[key] = value as BroadcastSegment[K];
      return next;
    });
  }

  return (
    <PageBody>
      <div className="stack">
        <div className="grid" style={{ gridTemplateColumns: '1fr minmax(280px, 340px)' }}>
          <div className="stack">
            <div className="panel">
              <div className="panel-head"><div className="panel-title">Who gets it</div></div>
              <div className="panel-body grid c2" style={{ gap: 12 }}>
                <div className="field">
                  <label className="field-label">Role</label>
                  <select className="select" value={segment.role ?? ''} onChange={(e) => setSeg('role', e.target.value as never)}>
                    <option value="">Everyone</option>
                    <option value="brand">Brands only</option>
                    <option value="influencer">Creators only</option>
                  </select>
                </div>
                <div className="field">
                  <label className="field-label">Verification</label>
                  <select className="select" value={segment.verification_status ?? ''}
                    onChange={(e) => setSeg('verification_status', e.target.value as never)}>
                    <option value="">Any</option>
                    <option value="approved">Verified</option>
                    <option value="pending">Awaiting review</option>
                    <option value="none">Never requested</option>
                  </select>
                </div>
                <div className="field">
                  <label className="field-label">Joined after</label>
                  <input className="input" type="date" value={segment.created_from ?? ''}
                    onChange={(e) => setSeg('created_from', e.target.value)} />
                </div>
                <div className="field">
                  <label className="field-label">Joined before</label>
                  <input className="input" type="date" value={segment.created_to ?? ''}
                    onChange={(e) => setSeg('created_to', e.target.value)} />
                </div>
                <div className="field">
                  <label className="field-label">Location contains</label>
                  <input className="input" value={segment.location ?? ''} placeholder="e.g. Mumbai"
                    onChange={(e) => setSeg('location', e.target.value)} />
                </div>
                <div className="field" style={{ justifyContent: 'flex-end' }}>
                  <label className="check">
                    <input type="checkbox" checked={segment.has_push_token === true}
                      onChange={(e) => setSeg('has_push_token', e.target.checked ? true : '')} />
                    Only people with a device registered
                  </label>
                </div>
              </div>
            </div>

            <div className="panel">
              <div className="panel-head"><div className="panel-title">What it says</div></div>
              <div className="panel-body stack" style={{ gap: 12 }}>
                <div className="field">
                  <label className="field-label" htmlFor="b-title">Title</label>
                  <input id="b-title" className="input" value={title} maxLength={120}
                    onChange={(e) => setTitle(e.target.value)} placeholder="Likes are live" />
                  <div className="field-hint">{title.length}/120</div>
                </div>
                <div className="field">
                  <label className="field-label" htmlFor="b-body">Body</label>
                  <textarea id="b-body" className="textarea" value={body} maxLength={400}
                    onChange={(e) => setBody(e.target.value)}
                    placeholder="You can now see everyone who liked you. Open the app to take a look." />
                  <div className="field-hint">{body.length}/400</div>
                </div>
              </div>
            </div>
          </div>

          {/* Audience and preview, side by side with the composer */}
          <div className="stack">
            <div className="panel">
              <div className="panel-head"><div className="panel-title">Audience</div></div>
              <div className="panel-body stack">
                {preview.isLoading && <SkeletonBlock height={70} />}
                {preview.isError && <ErrorBox error={preview.error} />}
                {preview.data && (
                  <>
                    <div>
                      <div className="stat-value">{fmtNum(preview.data.recipients)}</div>
                      <div className="stat-delta">
                        {fmtNum(preview.data.with_push_token)} have a device registered and will get a push.
                        The rest see it in the app.
                      </div>
                    </div>
                    {preview.data.sample.length > 0 && (
                      <div>
                        <div className="stat-label" style={{ marginBottom: 5 }}>Sample</div>
                        <div className="stack" style={{ gap: 3 }}>
                          {preview.data.sample.map((u) => (
                            <div key={u.id} className="tiny muted truncate">
                              {u.name ?? u.id} {u.role && <Badge>{u.role}</Badge>}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>

            {/* What it actually looks like on a phone. */}
            <div className="panel">
              <div className="panel-head"><div className="panel-title">Preview</div></div>
              <div className="panel-body">
                <div style={{
                  background: 'var(--panel-3)', borderRadius: 'var(--r-3)', padding: '10px 12px',
                  border: '1px solid var(--line-2)', display: 'flex', gap: 9,
                }}>
                  <div className="rail-mark" style={{ width: 22, height: 22, fontSize: 11 }}>M</div>
                  <div style={{ minWidth: 0 }}>
                    <div className="strong" style={{ fontSize: 12.5 }}>{title.trim() || 'Title'}</div>
                    <div className="small muted" style={{ marginTop: 1 }}>{body.trim() || 'Body text appears here.'}</div>
                  </div>
                </div>
              </div>
            </div>

            <button className="btn primary" style={{ height: 34 }} disabled={!ready} onClick={() => setConfirming(true)}>
              <Send size={14} /> Send broadcast
            </button>
            {!ready && (
              <div className="tiny muted">
                {(preview.data?.recipients ?? 0) === 0 ? 'This segment matches nobody.' : 'Write a title and a body first.'}
              </div>
            )}
          </div>
        </div>

        <div className="panel">
          <div className="panel-head"><div className="panel-title">Sent before</div></div>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr><th>Title</th><th>Body</th><th className="num">Recipients</th><th>Sent by</th><th>When</th></tr>
              </thead>
              <tbody>
                {(history.data?.data ?? []).map((b) => (
                  <tr key={b.id}>
                    <td className="strong">{b.title}</td>
                    <td className="wrap muted">{b.body}</td>
                    <td className="num">{fmtNum(b.recipient_count)}</td>
                    <td className="muted truncate" style={{ maxWidth: 180 }}>{b.admin_email ?? b.admin_id}</td>
                    <td className="muted">{fmtDateTime(b.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {history.data && history.data.data.length === 0 && (
              <Empty icon={<Bell size={22} />} title="No broadcasts yet"
                text="Nothing has been sent to the whole user base." />
            )}
          </div>
        </div>
      </div>

      {confirming && (
        <ConfirmAction
          title="Send this to everyone in the segment"
          target={`${fmtNum(preview.data?.recipients ?? 0)} people`}
          consequence="A broadcast cannot be recalled. It writes an in-app notice for every recipient and pushes to every registered device."
          confirmLabel={`Send to ${fmtNum(preview.data?.recipients ?? 0)}`}
          tone="danger"
          requireReason={false}
          onConfirm={() => send.mutateAsync()}
          onClose={() => setConfirming(false)}
          extra={
            <div>
              <div className="field-label" style={{ marginBottom: 5 }}>
                <Users size={12} style={{ verticalAlign: -2 }} /> They will read
              </div>
              <div className="pre">{title.trim()}{'\n\n'}{body.trim()}</div>
            </div>
          }
        />
      )}
    </PageBody>
  );
}
