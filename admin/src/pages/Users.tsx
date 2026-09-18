import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Ban, RotateCcw, Users as UsersIcon } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { PageBody } from '../components/Shell';
import {
  Avatar, Badge, ConfirmAction, Empty, ErrorBox, Pager, SearchInput, SkeletonRows, useCursorPager, useToast,
} from '../components/ui';
import { fmtDate, fmtNum, shortId } from '../lib/format';
import type { AdminUserRow, Paged } from '../lib/types';
import { UserDrawer } from './UserDetail';

type Filters = {
  role: string; banned: string; verification_status: string;
  has_matches: string; include_deleted: string; search: string;
};

const EMPTY: Filters = {
  role: '', banned: '', verification_status: '', has_matches: '', include_deleted: '', search: '',
};

export default function Users() {
  const { can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const pager = useCursorPager();

  const [filters, setFilters] = useState<Filters>({ ...EMPTY, search: params.get('search') ?? '' });
  const [debounced, setDebounced] = useState(filters.search);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openUser, setOpenUser] = useState<string | null>(null);
  const [bulk, setBulk] = useState<'ban' | 'unban' | null>(null);

  // A search fires a trigram query across three tables; one per keystroke is
  // a lot of load for characters the operator is still typing.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(filters.search), 280);
    return () => clearTimeout(t);
  }, [filters.search]);

  useEffect(() => { pager.reset(); setSelected(new Set()); },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [debounced, filters.role, filters.banned, filters.verification_status, filters.has_matches, filters.include_deleted]);

  const query = useMemo(() => ({
    role: filters.role || undefined,
    banned: filters.banned || undefined,
    verification_status: filters.verification_status || undefined,
    has_matches: filters.has_matches || undefined,
    include_deleted: filters.include_deleted || undefined,
    search: debounced.trim().length >= 2 ? debounced.trim() : undefined,
    cursor: pager.cursor || undefined,
    limit: 50,
    count: true,
  }), [filters, debounced, pager.cursor]);

  const list = useQuery({
    queryKey: ['users', query],
    queryFn: () => api.get<Paged<AdminUserRow>>('/users', query),
  });

  const rows = list.data?.data ?? [];

  const bulkMutation = useMutation({
    mutationFn: ({ action, reason }: { action: 'ban' | 'unban'; reason: string }) =>
      api.post<{ affected: number; missing: string[] }>(`/users/bulk-${action}`, {
        userIds: [...selected], reason,
      }),
    onSuccess: (res, vars) => {
      toast.success(
        `${res.affected} ${res.affected === 1 ? 'account' : 'accounts'} ${vars.action === 'ban' ? 'banned' : 'unbanned'}`,
        res.missing.length ? `${res.missing.length} id(s) did not exist` : undefined,
      );
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ['users'] });
      qc.invalidateQueries({ queryKey: ['stats'] });
    },
    onError: toast.error,
  });

  const allOnPage = rows.length > 0 && rows.every((r) => selected.has(r.id));

  function toggleAll() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allOnPage) rows.forEach((r) => next.delete(r.id));
      else rows.forEach((r) => next.add(r.id));
      return next;
    });
  }

  async function exportCsv() {
    try {
      await api.download('/users/export.csv', query, `matchr-users-${new Date().toISOString().slice(0, 10)}.csv`);
      toast.success('Export started', 'The file matches the filters on screen.');
    } catch (err) {
      toast.error(err);
    }
  }

  const activeFilters = Object.entries(filters).filter(([, v]) => v).length;

  return (
    <PageBody wide>
      <div className="stack">
        <div className="panel">
          <div className="panel-head" style={{ flexWrap: 'wrap' }}>
            <SearchInput
              value={filters.search}
              onChange={(v) => { setFilters((f) => ({ ...f, search: v })); setParams(v ? { search: v } : {}); }}
              placeholder="Name, email or user id"
              width={260}
            />
            <select className="select" style={{ width: 130 }} value={filters.role}
              onChange={(e) => setFilters((f) => ({ ...f, role: e.target.value }))}>
              <option value="">Any role</option>
              <option value="brand">Brands</option>
              <option value="influencer">Creators</option>
            </select>
            <select className="select" style={{ width: 130 }} value={filters.banned}
              onChange={(e) => setFilters((f) => ({ ...f, banned: e.target.value }))}>
              <option value="">Any status</option>
              <option value="false">Active</option>
              <option value="true">Banned</option>
            </select>
            <select className="select" style={{ width: 155 }} value={filters.verification_status}
              onChange={(e) => setFilters((f) => ({ ...f, verification_status: e.target.value }))}>
              <option value="">Any verification</option>
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
              <option value="none">Not requested</option>
            </select>
            <select className="select" style={{ width: 135 }} value={filters.has_matches}
              onChange={(e) => setFilters((f) => ({ ...f, has_matches: e.target.value }))}>
              <option value="">Any activity</option>
              <option value="true">Has matched</option>
              <option value="false">Never matched</option>
            </select>
            <label className="check small">
              <input type="checkbox" checked={filters.include_deleted === 'true'}
                onChange={(e) => setFilters((f) => ({ ...f, include_deleted: e.target.checked ? 'true' : '' }))} />
              Include deleted
            </label>

            <div className="panel-actions">
              {activeFilters > 0 && (
                <button className="btn sm ghost" onClick={() => { setFilters(EMPTY); setParams({}); }}>
                  Clear
                </button>
              )}
              {can('users:export') && (
                <button className="btn sm" onClick={exportCsv}>
                  <Download size={13} /> Export CSV
                </button>
              )}
            </div>
          </div>

          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  {can('users:ban') && (
                    <th style={{ width: 34 }}>
                      <input type="checkbox" checked={allOnPage} onChange={toggleAll}
                        aria-label="Select all on this page" style={{ accentColor: 'var(--accent)' }} />
                    </th>
                  )}
                  <th>User</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Verification</th>
                  <th className="num">Matches</th>
                  <th>Joined</th>
                  <th style={{ width: 90 }}>ID</th>
                </tr>
              </thead>

              {list.isLoading ? <SkeletonRows rows={10} cols={can('users:ban') ? 8 : 7} /> : (
                <tbody>
                  {rows.map((u) => (
                    <tr
                      key={u.id}
                      className={`clickable${selected.has(u.id) ? ' selected' : ''}`}
                      onClick={() => setOpenUser(u.id)}
                    >
                      {can('users:ban') && (
                        <td onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={selected.has(u.id)}
                            style={{ accentColor: 'var(--accent)' }}
                            aria-label={`Select ${u.name ?? u.email}`}
                            onChange={() => setSelected((prev) => {
                              const next = new Set(prev);
                              if (next.has(u.id)) next.delete(u.id); else next.add(u.id);
                              return next;
                            })}
                          />
                        </td>
                      )}
                      <td>
                        <div className="cell-name">
                          <Avatar src={u.avatar_url} name={u.name ?? u.email} />
                          <span className="truncate" style={{ maxWidth: 240 }}>
                            {u.name || <span className="muted">No name</span>}
                            <span className="muted"> · {u.email}</span>
                          </span>
                        </div>
                      </td>
                      <td>{u.role ? <Badge>{u.role === 'brand' ? 'Brand' : 'Creator'}</Badge> : <span className="muted">—</span>}</td>
                      <td>
                        {u.deleted_at ? <Badge tone="neutral" dot>Deleted</Badge>
                          : u.banned ? <Badge tone="danger" dot>Banned</Badge>
                            : <Badge tone="ok" dot>Active</Badge>}
                      </td>
                      <td>
                        {u.verification_status === 'approved' ? <Badge tone="info">Verified</Badge>
                          : u.verification_status === 'pending' ? <Badge tone="warn">Pending</Badge>
                            : u.verification_status === 'rejected' ? <Badge tone="neutral">Rejected</Badge>
                              : <span className="muted">—</span>}
                      </td>
                      <td className="num">{fmtNum(u.match_count)}</td>
                      <td className="muted">{fmtDate(u.created_at)}</td>
                      <td><span className="cell-id" title={u.id}>{shortId(u.id)}</span></td>
                    </tr>
                  ))}
                </tbody>
              )}
            </table>

            {list.isError && <ErrorBox error={list.error} onRetry={() => list.refetch()} />}
            {!list.isLoading && !list.isError && rows.length === 0 && (
              <Empty
                icon={<UsersIcon size={22} />}
                title="No users match these filters"
                text={activeFilters ? 'Clear a filter to widen the search.' : 'Nobody has signed up yet.'}
                action={activeFilters ? <button className="btn sm" onClick={() => setFilters(EMPTY)}>Clear filters</button> : undefined}
              />
            )}
          </div>

          {selected.size > 0 && (
            <div className="bulkbar">
              <b>{selected.size} selected</b>
              <button className="btn sm ghost" onClick={() => setSelected(new Set())}>Clear</button>
              <div className="spacer" />
              <button className="btn sm danger" onClick={() => setBulk('ban')}>
                <Ban size={13} /> Ban selected
              </button>
              <button className="btn sm" onClick={() => setBulk('unban')}>
                <RotateCcw size={13} /> Unban selected
              </button>
            </div>
          )}

          <div className="panel-head" style={{ borderTop: '1px solid var(--line)', borderBottom: 'none' }}>
            <Pager pager={pager} nextCursor={list.data?.next_cursor ?? null} count={rows.length} />
            {list.data?.total !== undefined && (
              <div className="small muted" style={{ marginLeft: 'auto' }}>{fmtNum(list.data.total)} total</div>
            )}
          </div>
        </div>
      </div>

      {openUser && (
        <UserDrawer
          userId={openUser}
          onClose={() => setOpenUser(null)}
          footer={<Link className="btn" to={`/users/${openUser}`}>Open full record</Link>}
        />
      )}

      {bulk && (
        <ConfirmAction
          title={bulk === 'ban' ? 'Ban selected accounts' : 'Unban selected accounts'}
          target={`${selected.size} ${selected.size === 1 ? 'account' : 'accounts'}`}
          consequence={bulk === 'ban'
            ? 'They lose their sessions immediately, stop appearing in anyone\'s feed, and their profiles stop resolving.'
            : 'They can sign in again and will reappear in feeds.'}
          confirmLabel={bulk === 'ban' ? 'Ban them' : 'Unban them'}
          tone={bulk === 'ban' ? 'danger' : 'primary'}
          requireReason={bulk === 'ban'}
          onConfirm={(reason) => bulkMutation.mutateAsync({ action: bulk, reason })}
          onClose={() => setBulk(null)}
        />
      )}
    </PageBody>
  );
}
