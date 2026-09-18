import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Download, FileText } from 'lucide-react';
import { api } from '../lib/api';
import { PageBody } from '../components/Shell';
import { Badge, Empty, ErrorBox, Pager, SearchInput, SkeletonRows, useCursorPager, useToast } from '../components/ui';
import { fmtDateTime, humanizeAction, shortId } from '../lib/format';
import type { AuditRow, Paged } from '../lib/types';

export default function Audit() {
  const toast = useToast();
  const pager = useCursorPager();

  const [action, setAction] = useState('');
  const [targetType, setTargetType] = useState('');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 280);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => { pager.reset(); },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [action, targetType, debounced]);

  const query = {
    action: action || undefined,
    target_type: targetType || undefined,
    search: debounced || undefined,
    cursor: pager.cursor || undefined,
    limit: 100,
  };

  const list = useQuery({
    queryKey: ['audit', query],
    queryFn: () => api.get<Paged<AuditRow>>('/audit', query),
  });
  const rows = list.data?.data ?? [];

  async function exportCsv() {
    try {
      await api.download('/audit/export.csv', query, `matchr-audit-${new Date().toISOString().slice(0, 10)}.csv`);
      toast.success('Export started');
    } catch (err) {
      toast.error(err);
    }
  }

  return (
    <PageBody wide>
      <div className="stack">
        <div className="panel">
          <div className="panel-head" style={{ flexWrap: 'wrap' }}>
            <SearchInput value={search} onChange={setSearch} placeholder="Search reasons" width={230} />
            <select className="select" style={{ width: 190 }} value={action} onChange={(e) => setAction(e.target.value)}>
              <option value="">Any action</option>
              <optgroup label="Accounts">
                <option value="user.ban">Ban</option>
                <option value="user.unban">Unban</option>
                <option value="user.soft_delete">Soft delete</option>
                <option value="user.hard_delete">Permanent delete</option>
                <option value="user.profile_update">Profile edit</option>
                <option value="user.export">User export</option>
              </optgroup>
              <optgroup label="Privacy">
                <option value="messages.read_thread">Read a conversation</option>
                <option value="messages.read_context">Read a reported message</option>
                <option value="user.onboarding_read">Read onboarding data</option>
              </optgroup>
              <optgroup label="Moderation">
                <option value="report.ban_target">Report → ban</option>
                <option value="report.delete_content">Report → delete</option>
                <option value="report.dismiss">Report → dismiss</option>
                <option value="verification.review">Verification decision</option>
              </optgroup>
              <optgroup label="Platform">
                <option value="setting.update">Settings change</option>
                <option value="broadcast.send">Broadcast</option>
                <option value="admin.grant">Admin granted</option>
                <option value="admin.revoke">Admin revoked</option>
              </optgroup>
            </select>
            <select className="select" style={{ width: 140 }} value={targetType} onChange={(e) => setTargetType(e.target.value)}>
              <option value="">Any target</option>
              {['user', 'post', 'story', 'message', 'report', 'match', 'setting', 'admin', 'broadcast', 'rating']
                .map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <div className="panel-actions">
              <button className="btn sm" onClick={exportCsv}><Download size={13} /> Export CSV</button>
            </div>
          </div>

          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th style={{ width: 28 }} />
                  <th style={{ width: 160 }}>When</th>
                  <th style={{ width: 200 }}>Action</th>
                  <th>Who</th>
                  <th style={{ width: 220 }}>Target</th>
                  <th>Reason</th>
                  <th style={{ width: 60 }} className="num">Status</th>
                </tr>
              </thead>
              {list.isLoading ? <SkeletonRows rows={12} cols={7} /> : (
                <tbody>
                  {rows.map((r) => (
                    <>
                      <tr key={r.id} className="clickable"
                        onClick={() => setExpanded(expanded === r.id ? null : r.id)}>
                        <td>{expanded === r.id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</td>
                        <td className="muted">{fmtDateTime(r.created_at)}</td>
                        <td>
                          <span className={isSensitive(r.action) ? 'strong' : ''}
                            style={isSensitive(r.action) ? { color: 'var(--warn)' } : undefined}>
                            {humanizeAction(r.action)}
                          </span>
                        </td>
                        <td className="truncate" style={{ maxWidth: 200 }}>
                          {r.admin_email ?? r.admin_id}
                          {r.admin_role && <Badge>{r.admin_role}</Badge>}
                        </td>
                        <td>
                          {r.target_type
                            ? <span className="small">{r.target_type} <span className="cell-id">{shortId(r.target_id, 10)}</span></span>
                            : <span className="muted">—</span>}
                        </td>
                        <td className="truncate muted" style={{ maxWidth: 320 }}>{r.reason ?? '—'}</td>
                        <td className="num">
                          {r.status
                            ? <Badge tone={r.status < 300 ? 'ok' : r.status < 500 ? 'warn' : 'danger'}>{r.status}</Badge>
                            : '—'}
                        </td>
                      </tr>
                      {expanded === r.id && (
                        <tr key={`${r.id}-detail`}>
                          <td colSpan={7} style={{ height: 'auto', padding: '10px 12px 14px', background: 'var(--bg-sunken)' }}>
                            <div className="grid c2" style={{ gap: 12 }}>
                              <div>
                                <div className="stat-label" style={{ marginBottom: 5 }}>Context</div>
                                <dl className="kv" style={{ gridTemplateColumns: '90px 1fr' }}>
                                  <dt>Admin id</dt><dd className="mono">{r.admin_id}</dd>
                                  <dt>Raw action</dt><dd className="mono">{r.action}</dd>
                                  <dt>Target id</dt><dd className="mono">{r.target_id ?? '—'}</dd>
                                  <dt>IP</dt><dd className="mono">{r.ip ?? '—'}</dd>
                                  <dt>Agent</dt><dd className="tiny">{r.user_agent ?? '—'}</dd>
                                </dl>
                              </div>
                              <div>
                                <div className="stat-label" style={{ marginBottom: 5 }}>
                                  What changed
                                  <span className="tiny muted" style={{ textTransform: 'none', letterSpacing: 0 }}>
                                    — secrets and message text are redacted before storage
                                  </span>
                                </div>
                                <pre className="pre">{JSON.stringify(r.metadata ?? {}, null, 2)}</pre>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  ))}
                </tbody>
              )}
            </table>

            {list.isError && <ErrorBox error={list.error} onRetry={() => list.refetch()} />}
            {!list.isLoading && rows.length === 0 && (
              <Empty icon={<FileText size={22} />} title="Nothing recorded"
                text="No admin action matches these filters." />
            )}
          </div>

          <div className="panel-head" style={{ borderTop: '1px solid var(--line)', borderBottom: 'none' }}>
            <Pager pager={pager} nextCursor={list.data?.next_cursor ?? null} count={rows.length} />
            <div className="tiny muted" style={{ marginLeft: 'auto' }}>Append only — nothing here can be edited or deleted.</div>
          </div>
        </div>
      </div>
    </PageBody>
  );
}

/** The actions worth spotting at a glance in a long list. */
function isSensitive(action: string): boolean {
  return action.startsWith('messages.read')
    || action === 'user.hard_delete'
    || action === 'broadcast.send'
    || action === 'user.export'
    || action.startsWith('admin.');
}
