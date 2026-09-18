import { useMemo, useState } from 'react';
import { fmtCompact, fmtDayShort, fmtNum, fmtPct } from '../lib/format';

/**
 * Hand-rolled SVG rather than a charting library.
 *
 * Two forms are needed here — a multi-series time series and a funnel — and
 * both want the exact mark specs the design calls for (2px lines, ≥8px hover
 * markers, a recessive grid, a crosshair tooltip, direct labels). Bending a
 * library into that costs more code than drawing it, and ~100KB more bundle.
 *
 * Series colours come from the validated palette in tokens.css and are
 * assigned in fixed order, never cycled: a 6th series would fold into "Other"
 * rather than reuse a hue.
 */
export const SERIES_COLORS = [
  'var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)', 'var(--series-5)',
];

export interface SeriesDef<T> {
  key: keyof T & string;
  label: string;
}

/* ── Time series ───────────────────────────────────────────────── */
export function TimeSeriesChart<T extends { day: string }>({
  data, series, height = 220,
}: {
  data: T[];
  series: SeriesDef<T>[];
  height?: number;
}) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const visible = series.filter((s) => !hidden.has(s.key));

  const W = 1000;
  const H = height;
  const pad = { top: 12, right: 14, bottom: 26, left: 46 };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;

  const max = useMemo(() => {
    let m = 0;
    for (const row of data) {
      for (const s of visible) m = Math.max(m, Number(row[s.key] ?? 0));
    }
    // A flat-zero chart still needs a scale, and a "1" ceiling makes a single
    // event look like a spike to the top.
    return m <= 0 ? 4 : m;
  }, [data, visible]);

  const ticks = useMemo(() => niceTicks(max, 4), [max]);
  const yMax = ticks[ticks.length - 1];

  const x = (i: number) => pad.left + (data.length <= 1 ? plotW / 2 : (i / (data.length - 1)) * plotW);
  const y = (v: number) => pad.top + plotH - (v / yMax) * plotH;

  // Colour follows the series, never its rank among the visible ones: hiding
  // one from the legend must not repaint the survivors.
  const colorOf = (key: string) =>
    SERIES_COLORS[series.findIndex((s) => s.key === key) % SERIES_COLORS.length];

  const paths = visible.map((s) => ({
    ...s,
    d: data.map((row, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(Number(row[s.key] ?? 0)).toFixed(1)}`).join(''),
  }));

  // Roughly one label per 90px, so they never collide at any range length.
  const labelEvery = Math.max(1, Math.ceil(data.length / Math.floor(plotW / 90)));

  function onMove(e: React.MouseEvent<SVGRectElement>) {
    if (!data.length) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    const idx = Math.round(ratio * (data.length - 1));
    setHoverIdx(Math.max(0, Math.min(data.length - 1, idx)));
  }

  const hovered = hoverIdx !== null ? data[hoverIdx] : null;
  const tooltipLeft = hoverIdx === null ? 0 : (x(hoverIdx) / W) * 100;

  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Activity over time" preserveAspectRatio="none"
        style={{ height }}>
        {ticks.map((t) => (
          <g key={t}>
            <line className="chart-grid" x1={pad.left} x2={W - pad.right} y1={y(t)} y2={y(t)} />
            <text className="chart-axis" x={pad.left - 8} y={y(t) + 3} textAnchor="end">{fmtCompact(t)}</text>
          </g>
        ))}

        {data.map((row, i) => (i % labelEvery === 0 || i === data.length - 1) && (
          <text key={row.day} className="chart-axis" x={x(i)} y={H - 8} textAnchor={i === 0 ? 'start' : i === data.length - 1 ? 'end' : 'middle'}>
            {fmtDayShort(row.day)}
          </text>
        ))}

        {hoverIdx !== null && (
          <line className="chart-crosshair" x1={x(hoverIdx)} x2={x(hoverIdx)} y1={pad.top} y2={pad.top + plotH} />
        )}

        {paths.map((p) => (
          <path key={p.key} className="chart-line" d={p.d} stroke={colorOf(p.key)} />
        ))}

        {/* A ring in the surface colour keeps overlapping markers legible. */}
        {hoverIdx !== null && visible.map((s) => (
          <circle
            key={s.key}
            cx={x(hoverIdx)}
            cy={y(Number(data[hoverIdx][s.key] ?? 0))}
            r={4.5}
            fill={colorOf(s.key)}
            stroke="var(--panel)"
            strokeWidth={2}
          />
        ))}

        <rect
          className="chart-hit"
          x={pad.left} y={pad.top} width={plotW} height={plotH}
          onMouseMove={onMove}
          onMouseLeave={() => setHoverIdx(null)}
        />
      </svg>

      {hovered && (
        <div
          className="tooltip"
          style={{
            left: `clamp(0px, calc(${tooltipLeft}% - 80px), calc(100% - 170px))`,
            top: 4,
          }}
        >
          <div className="tooltip-title">{fmtDayShort(hovered.day)}</div>
          {visible.map((s) => (
            <div className="tooltip-row" key={s.key}>
              <i
                className="legend-swatch"
                style={{ background: colorOf(s.key) }}
              />
              <span className="name">{s.label}</span>
              <span className="val">{fmtNum(Number(hovered[s.key] ?? 0))}</span>
            </div>
          ))}
        </div>
      )}

      {/* Identity is never colour alone: the legend is always present, and it
          doubles as the series toggle. */}
      <div className="legend" style={{ marginTop: 10 }}>
        {series.map((s, i) => (
          <button
            key={s.key}
            className={`legend-item${hidden.has(s.key) ? ' off' : ''}`}
            style={{ background: 'none', border: 'none', padding: 0 }}
            onClick={() => setHidden((prev) => {
              const next = new Set(prev);
              // Never let the last series be hidden — an empty plot is not a view.
              if (next.has(s.key)) next.delete(s.key);
              else if (visible.length > 1) next.add(s.key);
              return next;
            })}
            aria-pressed={!hidden.has(s.key)}
          >
            <i className="legend-swatch" style={{ background: SERIES_COLORS[i % SERIES_COLORS.length] }} />
            {s.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Axis ticks at 1/2/5×10ⁿ, so labels read as round numbers. */
function niceTicks(max: number, count: number): number[] {
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw || 1));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
  const out: number[] = [];
  for (let v = 0; v <= max + step * 0.001; v += step) out.push(Math.round(v * 1000) / 1000);
  if (out.length < 2) out.push(step);
  return out;
}

/* ── Funnel ────────────────────────────────────────────────────── */
export function FunnelChart({ stages, cohort }: {
  stages: { key: string; label: string; count: number; pct_of_start: number; pct_of_prev: number }[];
  cohort: number;
}) {
  if (!cohort) {
    return <div className="small muted" style={{ padding: '18px 0' }}>Nobody signed up in this range.</div>;
  }
  return (
    <div className="funnel">
      {stages.map((s, i) => (
        <div className="funnel-stage" key={s.key}>
          <div className="funnel-label">{s.label}</div>
          <div className="funnel-track">
            <div
              className="funnel-fill"
              style={{
                width: `${Math.max(s.pct_of_start, s.count > 0 ? 1.5 : 0)}%`,
                // A single hue stepped by depth: this is one measure losing
                // people, not six different things.
                background: `color-mix(in oklab, var(--accent) ${100 - i * 13}%, var(--panel-3))`,
              }}
            />
          </div>
          <div className="funnel-meta">
            <b>{fmtNum(s.count)}</b> · {fmtPct(s.pct_of_start)}
            {i > 0 && <span title="of the previous stage"> ({fmtPct(s.pct_of_prev, 0)})</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── Sparkline ─────────────────────────────────────────────────── */
export function Sparkline({ values, color = 'var(--series-1)' }: { values: number[]; color?: string }) {
  if (values.length < 2) return null;
  const W = 100;
  const H = 22;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const d = values
    .map((v, i) => `${i ? 'L' : 'M'}${((i / (values.length - 1)) * W).toFixed(1)},${(H - ((v - min) / span) * H).toFixed(1)}`)
    .join('');

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: 72, height: 22, overflow: 'visible' }} aria-hidden>
      <path d={d} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/* ── Stat tile ─────────────────────────────────────────────────── */
export function Stat({ label, value, delta, hint, spark, onClick, tone }: {
  label: string;
  value: number | string;
  delta?: { value: number; label: string };
  hint?: string;
  spark?: number[];
  onClick?: () => void;
  tone?: 'danger' | 'warn';
}) {
  return (
    <div className={`stat${onClick ? ' clickable' : ''}`} onClick={onClick} role={onClick ? 'button' : undefined}>
      <div className="stat-label">{label}</div>
      <div className="stat-value" style={tone ? { color: `var(--${tone})` } : undefined}>
        {typeof value === 'number' ? fmtNum(value) : value}
      </div>
      <div className="row" style={{ gap: 8, minHeight: 22 }}>
        {delta && (
          <div className="stat-delta">
            <span className={delta.value > 0 ? 'up' : delta.value < 0 ? 'down' : ''}>
              {delta.value > 0 ? '+' : ''}{fmtNum(delta.value)}
            </span>{' '}
            {delta.label}
          </div>
        )}
        {hint && !delta && <div className="stat-delta">{hint}</div>}
        {spark && <div style={{ marginLeft: 'auto' }}><Sparkline values={spark} /></div>}
      </div>
    </div>
  );
}
