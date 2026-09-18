import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Ban, RotateCcw, Trash2, Undo2 } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { PageBody } from '../components/Shell';
import { Avatar, Badge, ConfirmAction, Drawer, ErrorBox, SkeletonBlock, useToast } from '../components/ui';
import { fmtDate, fmtDateTime, fmtNum, fmtRelative, humanizeAction } from '../lib/format';
import type { UserDetail as UserDetailType } from '../lib/types';

type PendingAction = 'ban' | 'unban' | 'soft-delete' | 'hard-delete' | 'restore' | null;

function useUser(userId: string) {
  return useQuery({
    queryKey: ['user', userId],
    queryFn: () => api.get<UserDetailType>(`/users/${userId}`),
  });
}

/** The actions, shared by the drawer and the full page so they cannot diverge. */
function useUserActions(userId: string, onDone?: () => void) {
  const qc = useQueryClient();
  const toast = useToast();

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['user', userId] });
    qc.invalidateQueries({ queryKey: ['users'] });
    qc.invalidateQueries({ queryKey: ['stats'] });
  };

  return useMutation({
    mutationFn: async ({ action, reason }: { action: Exclude<PendingAction, null>; reason: string }) => {
      switch (action) {
        case 'ban': return api.post(`/users/${userId}/ban`, { reason });
        case 'unban': return api.post(`/users/${userId}/unban`, { reason });
        case 'restore': return api.post(`/users/${userId}/restore`, { reason });
        case 'soft-delete': return api.delete(`/users/${userId}`, { reason });
        case 'hard-delete': return api.delete(`/users/${userId}`, { reason }, { hard: true });
      }
    },
    onSuccess: (_res, vars) => {
      toast.success(
        vars.action === 'hard-delete' ? 'Account permanently deleted' : `Account ${vars.action.replace('-', ' ')}d`,
      );
      invalidate();
      onDone?.();
    },
    onError: toast.error,
  });
}

/* ── Actions row, used in both surfaces ─────────────────────────── */
function UserActions({ detail, userId, onDone, compact }: {
  detail: UserDetailType; userId: string; onDone?: () => void; compact?: boolean;
}) {
  const { can } = useAuth();
  const [pending, setPending] = useState<PendingAction>(null);
  const mutation = useUserActions(userId, onDone);
  const u = detail.user;
  const size = compact ? ' sm' : '';

  const copy: Record<Exclude<PendingAction, null>, { title: string; consequence: string; label: string; min: number; danger: boolean }> = {
    ban: {
      title: 'Ban this account',
      consequence: 'Their sessions end immediately, their card stops being dealt into anyone\'s feed, and their profile stops resolving. Reversible.',
      label: 'Ban account', min: 5, danger: true,
    },
    unban: {
      title: 'Lift this ban',
      consequence: 'They can sign in again and will reappear in feeds.',
      label: 'Unban account', min: 0, danger: false,
    },
    'soft-delete': {
      title: 'Delete this account',
      consequence: 'Marked deleted and blocked from signing in. Their data stays in the database and this can be undone.',
      label: 'Delete account', min: 10, danger: true,
    },
    'hard-delete': {
      title: 'Permanently delete this account',
      consequence: 'Removes the database row, every uploaded file, and the Supabase identity. Swipes, matches, messages, posts and ratings cascade. This cannot be undone.',
      label: 'Delete permanently', min: 10, danger: true,
    },
    restore: {
      title: 'Restore this account',
      consequence: 'Clears the deletion and the ban. They can sign in again.',
      label: 'Restore account', min: 0, danger: false,
    },
  };

  return (
    <>
      <div className="btn-row">
        {can('users:ban') && !u.deleted_at && (
          u.banned
            ? <button className={`btn${size}`} onClick={() => setPending('unban')}><RotateCcw size={13} /> Unban</button>
            : <button className={`btn${size} danger`} onClick={() => setPending('ban')}><Ban size={13} /> Ban</button>
        )}
        {can('users:ban') && !u.deleted_at && (
          <button className={`btn${size} danger`} onClick={() => setPending('soft-delete')}>
            <Trash2 size={13} /> Delete
          </button>
        )}
        {can('users:delete') && u.deleted_at && (
          <button className={`btn${size}`} onClick={() => setPending('restore')}><Undo2 size={13} /> Restore</button>
        )}
        {can('users:delete') && (
          <button className={`btn${size} danger`} onClick={() => setPending('hard-delete')}>
            <Trash2 size={13} /> Delete permanently
          </button>
        )}
      </div>

      {pending && (
        <ConfirmAction
          title={copy[pending].title}
          target={`${u.name || u.email} · ${u.id}`}
          consequence={copy[pending].consequence}
          confirmLabel={copy[pending].label}
          tone={copy[pending].danger ? 'danger' : 'primary'}
          minReason={copy[pending].min || 5}
          requireReason={copy[pending].min > 0}
          onConfirm={(reason) => mutation.mutateAsync({ action: pending, reason })}
          onClose={() => setPending(null)}
        />
      )}
    </>
  );
}

/* ── Summary, shared ────────────────────────────────────────────── */
function Summary({ detail }: { detail: UserDetailType }) {
  const u = detail.user;
  const c = detail.counts;

  return (
    <div className="stack">
      <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
        <Avatar src={u.avatar_url} name={u.name ?? u.email} size="lg" />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="row" style={{ gap: 7, marginBottom: 2 }}>
            <span className="strong" style={{ fontSize: 15 }}>{u.name || 'No name'}</span>
            {u.role && <Badge>{u.role === 'brand' ? 'Brand' : 'Creator'}</Badge>}
            {u.admin_role && <Badge tone="accent">{u.admin_role}</Badge>}
          </div>
          <div className="small muted truncate">{u.email}</div>
          <div className="mono tiny muted" style={{ marginTop: 3 }}>{u.id}</div>
        </div>
      </div>

      {u.banned && (
        <div className="consequence">
          <Ban size={14} />
          <div>
            <b>Banned {fmtRelative(u.banned_at)}</b>
            {u.banned_reason && <div style={{ marginTop: 2 }}>{u.banned_reason}</div>}
            {u.banned_by && <div className="tiny muted" style={{ marginTop: 2 }}>by {u.banned_by}</div>}
          </div>
        </div>
      )}
      {u.deleted_at && (
        <div className="consequence neutral">
          <Trash2 size={14} />
          <div>Soft-deleted {fmtRelative(u.deleted_at)}. The data is still here and this is reversible.</div>
        </div>
      )}

      <div className="grid c4" style={{ gap: 10 }}>
        <MiniStat label="Matches" value={Number(c.matches_active ?? 0)} sub={`${fmtNum(c.matches_archived)} archived`} />
        <MiniStat label="Messages sent" value={Number(c.messages_sent ?? 0)} />
        <MiniStat label="Likes sent" value={Number(c.likes_sent ?? 0)} sub={`${fmtNum(c.swipes_sent)} swipes`} />
        <MiniStat label="Reports against" value={Number(c.reports_against ?? 0)}
          sub={`${fmtNum(c.reports_filed)} filed`} tone={Number(c.reports_against ?? 0) > 0 ? 'danger' : undefined} />
      </div>

      <dl className="kv">
        <dt>Joined</dt><dd>{fmtDateTime(u.created_at)}</dd>
        <dt>Last updated</dt><dd>{fmtDateTime(u.updated_at)}</dd>
        <dt>Verification</dt><dd>{u.verification_status ?? '—'}</dd>
        <dt>Push token</dt>
        {/* Only whether one exists: a push token is a device address. */}
        <dd>{u.has_push_token ? 'Registered' : 'None'}</dd>
        <dt>Blocks</dt>
        <dd>{fmtNum(c.blocks_made)} made · {fmtNum(c.blocks_received)} received</dd>
        {u.role === 'brand' && (
          <>
            <dt>Rating</dt>
            <dd>{c.rating_avg ? `${c.rating_avg} from ${fmtNum(c.ratings_received)}` : 'Not rated yet'}</dd>
          </>
        )}
      </dl>
    </div>
  );
}

function MiniStat({ label, value, sub, tone }: { label: string; value: number; sub?: string; tone?: 'danger' }) {
  return (
    <div>
      <div className="stat-label" style={{ fontSize: 10 }}>{label}</div>
      <div className="strong" style={{ fontSize: 17, fontVariantNumeric: 'tabular-nums', color: tone ? `var(--${tone})` : undefined }}>
        {fmtNum(value)}
      </div>
      {sub && <div className="tiny muted">{sub}</div>}
    </div>
  );
}

/* ── Drawer ─────────────────────────────────────────────────────── */
export function UserDrawer({ userId, onClose, footer }: {
  userId: string; onClose: () => void; footer?: ReactNode;
}) {
  const { data, isLoading, isError, error, refetch } = useUser(userId);

  return (
    <Drawer
      title={data?.user.name || data?.user.email || 'User'}
      subtitle={data?.user.email}
      onClose={onClose}
      footer={
        <>
          {data && <UserActions detail={data} userId={userId} compact />}
          <div className="spacer" />
          {footer}
        </>
      }
    >
      {isLoading && <SkeletonBlock height={280} />}
      {isError && <ErrorBox error={error} onRetry={refetch} />}
      {data && (
        <div className="stack">
          <Summary detail={data} />
          <ActivityLists detail={data} />
        </div>
      )}
    </Drawer>
  );
}

function ActivityLists({ detail }: { detail: UserDetailType }) {
  const r = detail.recent;
  return (
    <>
      {r.reports_against.length > 0 && (
        <div className="panel">
          <div className="panel-head"><div className="panel-title">Reports against this account</div></div>
          <table className="tbl">
            <tbody>
              {r.reports_against.map((rep) => (
                <tr key={rep.id}>
                  <td><Badge tone={rep.status === 'open' ? 'warn' : 'neutral'}>{rep.status}</Badge></td>
                  <td className="wrap">{rep.reason}{rep.details ? ` · ${rep.details}` : ''}</td>
                  <td className="num muted">{fmtRelative(rep.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {r.admin_actions.length > 0 && (
        <div className="panel">
          <div className="panel-head">
            <div className="panel-title">What this team has done to this account</div>
          </div>
          <table className="tbl">
            <tbody>
              {r.admin_actions.map((a) => (
                <tr key={a.id}>
                  <td>{humanizeAction(a.action)}</td>
                  <td className="muted truncate" style={{ maxWidth: 140 }}>{a.admin_email ?? a.admin_id}</td>
                  <td className="num muted">{fmtRelative(a.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {r.matches.length > 0 && (
        <div className="panel">
          <div className="panel-head"><div className="panel-title">Recent matches</div></div>
          <table className="tbl">
            <tbody>
              {r.matches.map((m) => (
                <tr key={m.id}>
                  <td className="truncate" style={{ maxWidth: 180 }}>{m.other_name ?? '—'}</td>
                  <td><Badge tone={m.status === 'active' ? 'ok' : 'neutral'}>{m.status}</Badge></td>
                  <td className="num muted">{fmtDate(m.matched_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/* ── Full page ──────────────────────────────────────────────────── */
export default function UserDetailPage() {
  const { userId = '' } = useParams();
  const navigate = useNavigate();
  const { data, isLoading, isError, error, refetch } = useUser(userId);

  return (
    <PageBody>
      <div className="stack">
        <div className="row">
          <Link className="btn sm ghost" to="/users"><ArrowLeft size={14} /> Users</Link>
          <div className="spacer" />
          {data && <UserActions detail={data} userId={userId} onDone={() => navigate('/users')} />}
        </div>

        {isLoading && <SkeletonBlock height={320} />}
        {isError && <ErrorBox error={error} onRetry={refetch} />}

        {data && (
          <>
            <div className="panel"><div className="panel-body"><Summary detail={data} /></div></div>

            {data.profile && (
              <div className="panel">
                <div className="panel-head"><div className="panel-title">Profile</div></div>
                <div className="panel-body">
                  <dl className="kv">
                    {Object.entries(data.profile)
                      .filter(([k]) => !['user_id', 'updated_at'].includes(k))
                      .map(([k, v]) => (
                        <div key={k} style={{ display: 'contents' }}>
                          <dt>{k.replace(/_/g, ' ')}</dt>
                          <dd>{renderValue(v)}</dd>
                        </div>
                      ))}
                  </dl>
                </div>
              </div>
            )}

            <ActivityLists detail={data} />
          </>
        )}
      </div>
    </PageBody>
  );
}

function renderValue(v: unknown): ReactNode {
  if (v === null || v === undefined || v === '') return <span className="muted">—</span>;
  if (Array.isArray(v)) {
    return v.length
      ? <div className="row wrap" style={{ gap: 5 }}>{v.map((x, i) => <Badge key={i}>{String(x)}</Badge>)}</div>
      : <span className="muted">—</span>;
  }
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'object') return <pre className="pre">{JSON.stringify(v, null, 2)}</pre>;
  const s = String(v);
  if (/^https?:\/\//.test(s)) {
    return <a href={s} target="_blank" rel="noreferrer noopener" style={{ color: 'var(--info)' }}>{s}</a>;
  }
  return s;
}
