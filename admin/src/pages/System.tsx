import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Check, X } from 'lucide-react';
import { api } from '../lib/api';
import { PageBody } from '../components/Shell';
import { Badge, ErrorBox, SkeletonBlock } from '../components/ui';
import { fmtDateTime, fmtDuration, fmtNum } from '../lib/format';
import type { SystemHealth } from '../lib/types';

export default function System() {
  const health = useQuery({
    queryKey: ['system'],
    queryFn: () => api.get<SystemHealth>('/system'),
    refetchInterval: 15_000,
  });

  if (health.isLoading) return <PageBody><SkeletonBlock height={320} /></PageBody>;
  if (health.isError) return <PageBody><ErrorBox error={health.error} onRetry={() => health.refetch()} /></PageBody>;

  const h = health.data!;
  const pool = h.database.pool ?? {};
  // Sustained queueing for a connection is the clearest early warning that
  // PG_POOL_MAX is too low for the number of instances running.
  const poolPressure = (pool.waiting ?? 0) > 0;

  return (
    <PageBody>
      <div className="stack">
        <div className="grid c4">
          <Health label="Database" ok={h.database.ok} detail={h.database.ok ? `${h.database.latency_ms} ms` : h.database.error} />
          <Health
            label="Redis"
            ok={h.redis.ok && h.redis.configured !== false}
            detail={h.redis.configured === false ? 'Not configured' : h.redis.ok ? `${h.redis.status} · ${h.redis.latency_ms} ms` : h.redis.error}
            warnOnly={h.redis.configured === false}
          />
          <Health
            label="Queues"
            ok={h.queues.ok && h.queues.configured !== false}
            detail={h.queues.configured === false ? 'Running inline' : h.queues.ok ? `${h.queues.queues?.length ?? 0} queues` : h.queues.error}
            warnOnly={h.queues.configured === false}
          />
          <Health
            label="Migrations"
            ok={h.migrations.up_to_date !== false}
            detail={h.migrations.up_to_date === false
              ? `Disk is at ${h.migrations.latest_on_disk}`
              : `${h.migrations.applied_count} applied`}
          />
        </div>

        {h.migrations.up_to_date === false && (
          <div className="panel"><div className="panel-body">
            <div className="consequence">
              <AlertTriangle size={14} />
              <div>
                <b>This deploy's migrations have not run.</b>
                <div>
                  The newest file on disk is <code className="mono">{h.migrations.latest_on_disk}</code> but the
                  database is at <code className="mono">{h.migrations.latest_applied}</code>. The API starts with
                  <code className="mono"> node migrate.js &amp;&amp; node src/app.js</code>, so check the deploy log.
                </div>
              </div>
            </div>
          </div></div>
        )}

        <div className="grid c2">
          <div className="panel">
            <div className="panel-head"><div className="panel-title">Build</div></div>
            <div className="panel-body">
              <dl className="kv">
                <dt>Commit</dt><dd className="mono">{h.build.commit}</dd>
                <dt>Environment</dt><dd>{h.build.node_env}</dd>
                <dt>Node</dt><dd className="mono">{h.build.node_version}</dd>
                <dt>Started</dt><dd>{fmtDateTime(h.build.started_at)}</dd>
                <dt>Uptime</dt><dd>{fmtDuration(h.build.uptime_s)}</dd>
                <dt>Sockets</dt>
                <dd>{h.build.sockets_enabled ? 'In this process' : 'Separate chat service'}</dd>
                <dt>Workers</dt>
                <dd>{h.build.workers_enabled ? 'In this process' : 'Separate worker service'}</dd>
              </dl>
            </div>
          </div>

          <div className="panel">
            <div className="panel-head">
              <div className="panel-title">Database pool</div>
              <div className="panel-actions">
                {poolPressure && <Badge tone="warn" dot>Requests are queueing</Badge>}
              </div>
            </div>
            <div className="panel-body">
              <dl className="kv">
                <dt>Latency</dt><dd>{h.database.latency_ms} ms</dd>
                <dt>Open</dt><dd>{fmtNum(pool.total)} of {fmtNum(pool.max)}</dd>
                <dt>Idle</dt><dd>{fmtNum(pool.idle)}</dd>
                <dt>Waiting</dt>
                <dd style={poolPressure ? { color: 'var(--warn)' } : undefined}>{fmtNum(pool.waiting)}</dd>
              </dl>
              {poolPressure && (
                <div className="tiny muted" style={{ marginTop: 9 }}>
                  Requests are waiting for a connection. If this persists, raise <code className="mono">PG_POOL_MAX</code>{' '}
                  or reduce the instance count — every instance opens its own pool.
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="panel-head">
            <div className="panel-title">Background queues</div>
            <div className="panel-sub">
              {h.queues.configured === false
                ? 'Redis is not configured, so jobs run inline in the API process'
                : 'BullMQ'}
            </div>
          </div>
          {h.queues.queues?.length ? (
            <div className="tbl-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Queue</th>
                    <th className="num">Waiting</th><th className="num">Active</th>
                    <th className="num">Delayed</th><th className="num">Failed</th><th className="num">Completed</th>
                  </tr>
                </thead>
                <tbody>
                  {h.queues.queues.map((q) => (
                    <tr key={q.name}>
                      <td>{q.name}</td>
                      {q.ok ? (
                        <>
                          <td className="num">{fmtNum(q.waiting as number)}</td>
                          <td className="num">{fmtNum(q.active as number)}</td>
                          <td className="num">{fmtNum(q.delayed as number)}</td>
                          <td className="num" style={(q.failed as number) > 0 ? { color: 'var(--danger)' } : undefined}>
                            {fmtNum(q.failed as number)}
                          </td>
                          <td className="num muted">{fmtNum(q.completed as number)}</td>
                        </>
                      ) : (
                        <td colSpan={5} className="muted">{q.error}</td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="panel-body small muted">
              No queues are running. Push notifications and feed warm-ups happen inline instead, which is fine at
              low volume and slower under load.
            </div>
          )}
        </div>

        <div className="panel">
          <div className="panel-head"><div className="panel-title">Migrations</div></div>
          <div className="panel-body">
            <dl className="kv">
              <dt>Latest applied</dt><dd className="mono">{h.migrations.latest_applied ?? '—'}</dd>
              <dt>Applied at</dt><dd>{fmtDateTime(h.migrations.applied_at)}</dd>
              <dt>Newest on disk</dt><dd className="mono">{h.migrations.latest_on_disk ?? '—'}</dd>
              <dt>Total applied</dt><dd>{fmtNum(h.migrations.applied_count)}</dd>
            </dl>
          </div>
        </div>
      </div>
    </PageBody>
  );
}

function Health({ label, ok, detail, warnOnly }: {
  label: string; ok: boolean; detail?: string; warnOnly?: boolean;
}) {
  const tone = ok ? 'ok' : warnOnly ? 'warn' : 'danger';
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="row" style={{ gap: 7 }}>
        {ok ? <Check size={17} color="var(--ok)" /> : <X size={17} color={`var(--${tone})`} />}
        <span className="strong" style={{ fontSize: 15, color: `var(--${tone})` }}>
          {ok ? 'Healthy' : warnOnly ? 'Degraded' : 'Down'}
        </span>
      </div>
      {detail && <div className="stat-delta truncate" title={detail}>{detail}</div>}
    </div>
  );
}
