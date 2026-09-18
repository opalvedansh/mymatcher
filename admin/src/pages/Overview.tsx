import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { PageBody } from '../components/Shell';
import { FunnelChart, Stat, TimeSeriesChart } from '../components/charts';
import { ErrorBox, SkeletonBlock } from '../components/ui';
import { fmtNum, fmtPct, fmtRelative, humanizeAction, isoDaysAgo, isoToday } from '../lib/format';
import type { AuditRow, Funnel, Paged, Stats, Timeseries, SeriesPoint } from '../lib/types';

const RANGES = [
  { days: 7, label: '7d' },
  { days: 30, label: '30d' },
  { days: 90, label: '90d' },
  { days: 365, label: '1y' },
];

const SERIES = [
  { key: 'signups', label: 'Signups' },
  { key: 'matches', label: 'Matches' },
  { key: 'messages', label: 'Messages' },
  { key: 'swipes', label: 'Swipes' },
  { key: 'likes', label: 'Likes' },
] as const;

export default function Overview() {
  const { can } = useAuth();
  const [days, setDays] = useState(30);
  const range = { from: isoDaysAgo(days - 1), to: isoToday() };

  const stats = useQuery({ queryKey: ['stats'], queryFn: () => api.get<Stats>('/stats') });
  const ts = useQuery({
    queryKey: ['timeseries', range.from, range.to],
    queryFn: () => api.get<Timeseries>('/metrics/timeseries', range),
  });
  const funnel = useQuery({
    queryKey: ['funnel', range.from, range.to],
    queryFn: () => api.get<Funnel>('/metrics/funnel', range),
  });
  const audit = useQuery({
    queryKey: ['audit', 'recent'],
    queryFn: () => api.get<Paged<AuditRow>>('/audit', { limit: 8 }),
    enabled: can('audit:read'),
  });

  const s = stats.data;
  const series = ts.data?.series ?? [];
  const spark = (key: keyof SeriesPoint) => series.slice(-14).map((d) => Number(d[key]));

  return (
    <PageBody>
      <div className="stack">
        {stats.isError ? (
          <ErrorBox error={stats.error} onRetry={() => stats.refetch()} />
        ) : (
          <div className="grid c4">
            {!s ? (
              Array.from({ length: 4 }, (_, i) => <SkeletonBlock key={i} height={92} />)
            ) : (
              <>
                <Stat
                  label="Users"
                  value={s.total_users}
                  delta={{ value: s.signups_24h, label: 'in 24h' }}
                  spark={spark('signups')}
                />
                <Stat
                  label="Active matches"
                  value={s.active_matches}
                  delta={{ value: s.matches_24h, label: 'in 24h' }}
                  spark={spark('matches')}
                />
                <Stat
                  label="Messages"
                  value={s.total_messages}
                  delta={{ value: s.messages_24h, label: 'in 24h' }}
                  spark={spark('messages')}
                />
                <Stat
                  label="Banned"
                  value={s.banned_users}
                  hint={`${fmtNum(s.deleted_users)} deleted`}
                  tone={s.banned_users > 0 ? 'warn' : undefined}
                />
              </>
            )}
          </div>
        )}

        {/* The two queues, first — this is what an operator opens the panel for. */}
        <div className="grid c2">
          <QueueCard
            to="/moderation"
            label="Open reports"
            value={s?.open_reports}
            empty="Nothing waiting for review."
            cta="Open the moderation queue"
          />
          <QueueCard
            to="/verifications"
            label="Pending verifications"
            value={s?.pending_verifications}
            empty="No businesses waiting on a decision."
            cta="Open the verification queue"
          />
        </div>

        <div className="panel">
          <div className="panel-head">
            <div>
              <div className="panel-title">Activity</div>
              <div className="panel-sub">Daily totals, {ts.data?.tz ?? 'Asia/Kolkata'}</div>
            </div>
            <div className="panel-actions">
              {RANGES.map((r) => (
                <button
                  key={r.days}
                  className={`btn sm${days === r.days ? ' primary' : ' ghost'}`}
                  onClick={() => setDays(r.days)}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>
          <div className="panel-body">
            {ts.isError ? <ErrorBox error={ts.error} onRetry={() => ts.refetch()} />
              : ts.isLoading ? <SkeletonBlock height={240} />
                : <TimeSeriesChart data={series} series={SERIES as unknown as { key: keyof SeriesPoint & string; label: string }[]} />}
          </div>
        </div>

        <div className="grid c2">
          <div className="panel">
            <div className="panel-head">
              <div>
                <div className="panel-title">Activation funnel</div>
                <div className="panel-sub">
                  {funnel.data ? `${fmtNum(funnel.data.cohort_size)} signed up in this range` : 'Loading'}
                </div>
              </div>
            </div>
            <div className="panel-body">
              {funnel.isError ? <ErrorBox error={funnel.error} onRetry={() => funnel.refetch()} />
                : !funnel.data ? <SkeletonBlock height={180} />
                  : (
                    <>
                      <FunnelChart stages={funnel.data.stages} cohort={funnel.data.cohort_size} />
                      {/* Reported beside the funnel, never as a stage: nothing in
                          the product requires a complete profile, so it is a
                          quality measure rather than a step people pass. */}
                      <div className="small muted" style={{ marginTop: 12, paddingTop: 11, borderTop: '1px solid var(--line)' }}>
                        {fmtNum(funnel.data.profile_complete.count)} of them filled their profile in properly
                        ({fmtPct(funnel.data.profile_complete.pct_of_start)}). The app does not require this.
                      </div>
                    </>
                  )}
            </div>
          </div>

          {can('audit:read') && (
            <div className="panel">
              <div className="panel-head">
                <div className="panel-title">Recent admin activity</div>
                <div className="panel-actions">
                  <Link className="btn sm ghost" to="/audit">All <ArrowUpRight size={13} /></Link>
                </div>
              </div>
              <div className="tbl-wrap">
                <table className="tbl">
                  <tbody>
                    {(audit.data?.data ?? []).map((row) => (
                      <tr key={row.id}>
                        <td className="truncate" style={{ maxWidth: 200 }}>{humanizeAction(row.action)}</td>
                        <td className="muted truncate" style={{ maxWidth: 160 }}>{row.admin_email ?? row.admin_id}</td>
                        <td className="num muted">{fmtRelative(row.created_at)}</td>
                      </tr>
                    ))}
                    {audit.data && audit.data.data.length === 0 && (
                      <tr><td className="muted" style={{ height: 80 }}>No admin actions recorded yet.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </PageBody>
  );
}

function QueueCard({ to, label, value, empty, cta }: {
  to: string; label: string; value?: number; empty: string; cta: string;
}) {
  const has = (value ?? 0) > 0;
  return (
    <div className="panel">
      <div className="panel-body row" style={{ gap: 14 }}>
        <div>
          <div className="stat-label">{label}</div>
          <div className="stat-value" style={{ color: has ? 'var(--accent)' : undefined }}>
            {value === undefined ? '—' : fmtNum(value)}
          </div>
          {!has && value !== undefined && <div className="stat-delta">{empty}</div>}
        </div>
        <div className="spacer" />
        <Link className={`btn ${has ? 'primary' : ''}`} to={to}>{has ? 'Review' : cta}</Link>
      </div>
    </div>
  );
}
