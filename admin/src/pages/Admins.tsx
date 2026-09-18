import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, ShieldOff, UserCog } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { PageBody } from '../components/Shell';
import { Badge, ConfirmAction, Empty, ErrorBox, Modal, SkeletonRows, useToast } from '../components/ui';
import { fmtDateTime, fmtRelative } from '../lib/format';
import type { AdminRole, AdminRow, Permission } from '../lib/types';

const ROLE_BLURB: Record<AdminRole, string> = {
  superadmin: 'Everything, including permanent deletion, reading conversations and managing admins.',
  moderator: 'The queues: reports, verifications, content removal, bans and the audit log.',
  support: 'Looks people up, edits profiles, bans, exports. No content removal, no conversations.',
  analyst: 'Read only. Metrics, lists and system health, nothing writable.',
};

export default function Admins() {
  const { can, me } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();

  const [includeRevoked, setIncludeRevoked] = useState(false);
  const [granting, setGranting] = useState(false);
  const [revoking, setRevoking] = useState<AdminRow | null>(null);

  const list = useQuery({
    queryKey: ['admins', includeRevoked],
    queryFn: () => api.get<{ data: AdminRow[] }>('/admins', { include_revoked: includeRevoked || undefined }),
  });

  const grant = useMutation({
    mutationFn: (v: { email: string; role: AdminRole; note: string }) => api.post('/admins', v),
    onSuccess: () => { toast.success('Access granted'); qc.invalidateQueries({ queryKey: ['admins'] }); setGranting(false); },
    onError: toast.error,
  });

  const changeRole = useMutation({
    mutationFn: (v: { userId: string; role: AdminRole }) => api.patch(`/admins/${v.userId}`, { role: v.role, reason: `Changed role to ${v.role}` }),
    onSuccess: () => { toast.success('Role changed'); qc.invalidateQueries({ queryKey: ['admins'] }); },
    onError: toast.error,
  });

  const revoke = useMutation({
    mutationFn: (v: { userId: string; reason: string }) => api.delete(`/admins/${v.userId}`, { reason: v.reason }),
    onSuccess: () => { toast.success('Access revoked'); qc.invalidateQueries({ queryKey: ['admins'] }); },
    onError: toast.error,
  });

  const rows = list.data?.data ?? [];
  const activeSuperadmins = rows.filter((r) => !r.revoked_at && r.role === 'superadmin').length;

  return (
    <PageBody>
      <div className="stack">
        <div className="panel">
          <div className="panel-head">
            <div className="panel-title">Staff accounts</div>
            <div className="panel-actions">
              <label className="check small">
                <input type="checkbox" checked={includeRevoked} onChange={(e) => setIncludeRevoked(e.target.checked)} />
                Show revoked
              </label>
              {can('admins:write') && (
                <button className="btn sm primary" onClick={() => setGranting(true)}><Plus size={13} /> Grant access</button>
              )}
            </div>
          </div>

          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Person</th><th style={{ width: 150 }}>Role</th><th>Added</th>
                  <th>Last action</th><th style={{ width: 110 }} />
                </tr>
              </thead>
              {list.isLoading ? <SkeletonRows rows={4} cols={5} /> : (
                <tbody>
                  {rows.map((a) => {
                    const isMe = a.user_id === me?.id;
                    const lastSuper = a.role === 'superadmin' && activeSuperadmins <= 1;
                    return (
                      <tr key={a.user_id} style={a.revoked_at ? { opacity: 0.5 } : undefined}>
                        <td>
                          <div className="truncate">
                            {a.email ?? <span className="muted">No email on record</span>}
                            {isMe && <Badge tone="accent">You</Badge>}
                          </div>
                          <div className="mono tiny muted">{a.user_id}</div>
                          {a.note && <div className="tiny muted">{a.note}</div>}
                        </td>
                        <td>
                          {can('admins:write') && !a.revoked_at && !isMe ? (
                            <select className="select" value={a.role}
                              onChange={(e) => changeRole.mutate({ userId: a.user_id, role: e.target.value as AdminRole })}>
                              {(Object.keys(ROLE_BLURB) as AdminRole[]).map((r) => <option key={r} value={r}>{r}</option>)}
                            </select>
                          ) : (
                            <Badge tone={a.role === 'superadmin' ? 'accent' : 'neutral'}>{a.role}</Badge>
                          )}
                        </td>
                        <td className="muted">
                          {fmtDateTime(a.created_at)}
                          <div className="tiny">by {a.created_by ?? 'unknown'}</div>
                        </td>
                        <td className="muted">{a.last_action_at ? fmtRelative(a.last_action_at) : 'Never'}</td>
                        <td>
                          {a.revoked_at ? (
                            <Badge tone="neutral">Revoked {fmtRelative(a.revoked_at)}</Badge>
                          ) : can('admins:write') && (
                            <button
                              className="btn sm danger"
                              disabled={isMe || lastSuper}
                              title={isMe ? 'You cannot revoke your own access'
                                : lastSuper ? 'This is the last superadmin' : undefined}
                              onClick={() => setRevoking(a)}
                            >
                              <ShieldOff size={12} /> Revoke
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              )}
            </table>
            {list.isError && <ErrorBox error={list.error} onRetry={() => list.refetch()} />}
            {!list.isLoading && rows.length === 0 && (
              <Empty icon={<UserCog size={22} />} title="No staff accounts" text="Nobody has been granted access." />
            )}
          </div>
        </div>

        {/* The permission matrix, visible rather than documented elsewhere. */}
        <div className="panel">
          <div className="panel-head"><div className="panel-title">What each role can do</div></div>
          <div className="panel-body stack" style={{ gap: 12 }}>
            {(Object.keys(ROLE_BLURB) as AdminRole[]).map((role) => {
              const perms = me?.roles.find((r) => r.role === role)?.permissions ?? [];
              return (
                <div key={role}>
                  <div className="row" style={{ marginBottom: 4 }}>
                    <Badge tone={role === 'superadmin' ? 'accent' : 'neutral'}>{role}</Badge>
                    <span className="small muted">{ROLE_BLURB[role]}</span>
                  </div>
                  <div className="row wrap" style={{ gap: 4 }}>
                    {perms.map((p: Permission) => <code key={p} className="mono tiny" style={{ opacity: 0.7 }}>{p}</code>)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {granting && <GrantModal onClose={() => setGranting(false)} onGrant={(v) => grant.mutateAsync(v)} />}

      {revoking && (
        <ConfirmAction
          title="Revoke admin access"
          target={revoking.email ?? revoking.user_id}
          consequence="They lose access within 30 seconds. Their audit history stays, so past actions still resolve to their name."
          confirmLabel="Revoke access"
          onConfirm={(reason) => revoke.mutateAsync({ userId: revoking.user_id, reason })}
          onClose={() => setRevoking(null)}
        />
      )}
    </PageBody>
  );
}

function GrantModal({ onClose, onGrant }: {
  onClose: () => void;
  onGrant: (v: { email: string; role: AdminRole; note: string }) => Promise<unknown>;
}) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<AdminRole>('moderator');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await onGrant({ email: email.trim(), role, note: note.trim() });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not grant access');
      setBusy(false);
    }
  }

  return (
    <Modal title="Grant admin access" onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn primary" onClick={submit} disabled={!email.includes('@') || busy}>
            {busy ? 'Granting…' : 'Grant access'}
          </button>
        </>
      }>
      <div className="field">
        <label className="field-label" htmlFor="g-email">Email</label>
        <input id="g-email" className="input" type="email" value={email} autoFocus spellCheck={false}
          onChange={(e) => setEmail(e.target.value)} placeholder="ops@matchr.in" />
        <div className="field-hint">
          They need a Supabase account first. They do not need to have used the app.
        </div>
      </div>

      <div className="field">
        <label className="field-label" htmlFor="g-role">Role</label>
        <select id="g-role" className="select" value={role} onChange={(e) => setRole(e.target.value as AdminRole)}>
          {(Object.keys(ROLE_BLURB) as AdminRole[]).map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <div className="field-hint">{ROLE_BLURB[role]}</div>
      </div>

      <div className="field">
        <label className="field-label" htmlFor="g-note">Note</label>
        <input id="g-note" className="input" value={note} onChange={(e) => setNote(e.target.value)}
          placeholder="Optional — who they are, why they need it" />
      </div>

      {error && <div className="field-error">{error}</div>}
    </Modal>
  );
}
