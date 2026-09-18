import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Flag, Plus, Sliders, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { PageBody } from '../components/Shell';
import { Badge, ConfirmAction, ErrorBox, SkeletonBlock, useToast } from '../components/ui';
import { fmtDateTime } from '../lib/format';
import type { AlgorithmWeights, MaintenanceMode, SettingRow } from '../lib/types';

const WEIGHT_LABELS: Record<keyof AlgorithmWeights, { label: string; hint: string }> = {
  CATEGORY_OVERLAP: { label: 'Category overlap', hint: 'How much shared categories matter' },
  BUDGET_FIT: { label: 'Budget fit', hint: 'Brand budget against creator price' },
  LOCATION_MATCH: { label: 'Location', hint: 'How close they are to each other' },
  COMPLETENESS: { label: 'Profile completeness', hint: 'Rewards a filled-in profile' },
};

export default function SettingsPage() {
  const { can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();

  const settings = useQuery({
    queryKey: ['settings'],
    queryFn: () => api.get<{ data: SettingRow[] }>('/settings'),
  });

  const save = useMutation({
    mutationFn: ({ key, value, reason }: { key: string; value: unknown; reason?: string }) =>
      api.put(`/settings/${key}`, { value, reason }),
    onSuccess: () => {
      toast.success('Saved');
      qc.invalidateQueries({ queryKey: ['settings'] });
    },
    onError: toast.error,
  });

  const find = <T,>(key: string) => settings.data?.data.find((s) => s.key === key)?.value as T | undefined;
  const meta = (key: string) => settings.data?.data.find((s) => s.key === key);

  if (settings.isLoading) return <PageBody><SkeletonBlock height={320} /></PageBody>;
  if (settings.isError) return <PageBody><ErrorBox error={settings.error} onRetry={() => settings.refetch()} /></PageBody>;

  return (
    <PageBody>
      <div className="stack">
        <Weights
          value={find<AlgorithmWeights>('algorithm_weights')}
          meta={meta('algorithm_weights')}
          readOnly={!can('settings:write')}
          onSave={(value, reason) => save.mutateAsync({ key: 'algorithm_weights', value, reason })}
        />
        <Flags
          value={find<Record<string, boolean>>('feature_flags') ?? {}}
          meta={meta('feature_flags')}
          readOnly={!can('settings:write')}
          onSave={(value, reason) => save.mutateAsync({ key: 'feature_flags', value, reason })}
        />
        <Maintenance
          value={find<MaintenanceMode>('maintenance_mode')}
          readOnly={!can('settings:write')}
          onSave={(value, reason) => save.mutateAsync({ key: 'maintenance_mode', value, reason })}
        />
      </div>
    </PageBody>
  );
}

/* ── Feed weights ───────────────────────────────────────────────── */
function Weights({ value, meta, readOnly, onSave }: {
  value?: AlgorithmWeights;
  meta?: SettingRow;
  readOnly: boolean;
  onSave: (v: AlgorithmWeights, reason: string) => Promise<unknown>;
}) {
  const [draft, setDraft] = useState<AlgorithmWeights | null>(null);
  useEffect(() => { if (value) setDraft(value); }, [value]);

  if (!draft) return null;
  const total = Object.values(draft).reduce((a, b) => a + Number(b), 0);
  const valid = total === 100;
  const dirty = JSON.stringify(draft) !== JSON.stringify(value);

  return (
    <div className="panel">
      <div className="panel-head">
        <Sliders size={15} />
        <div>
          <div className="panel-title">Feed ranking</div>
          <div className="panel-sub">
            {meta?.updated_at ? `Last changed ${fmtDateTime(meta.updated_at)} by ${meta.updated_by ?? 'unknown'}` : 'Never changed'}
          </div>
        </div>
        <div className="panel-actions">
          <Badge tone={valid ? 'ok' : 'danger'}>Total {total}</Badge>
        </div>
      </div>

      <div className="panel-body stack">
        {(Object.keys(WEIGHT_LABELS) as (keyof AlgorithmWeights)[]).map((key) => (
          <div key={key}>
            <div className="row" style={{ marginBottom: 4 }}>
              <div>
                <div className="small strong">{WEIGHT_LABELS[key].label}</div>
                <div className="tiny muted">{WEIGHT_LABELS[key].hint}</div>
              </div>
              <div className="spacer" />
              <input
                className="input num" style={{ width: 62, textAlign: 'right' }}
                type="number" min={0} max={100} value={draft[key]} disabled={readOnly}
                onChange={(e) => setDraft({ ...draft, [key]: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })}
              />
            </div>
            <input
              className="slider" type="range" min={0} max={100} value={draft[key]} disabled={readOnly}
              onChange={(e) => setDraft({ ...draft, [key]: Number(e.target.value) })}
            />
          </div>
        ))}

        {!valid && (
          <div className="consequence">
            <AlertTriangle size={14} />
            <div>
              The four weights must total exactly 100. They are currently {total}
              {total > 100 ? `, which is ${total - 100} too many.` : `, which is ${100 - total} short.`}
            </div>
          </div>
        )}

        {!readOnly && (
          <div className="btn-row">
            <button className="btn primary" disabled={!valid || !dirty}
              onClick={() => onSave(draft, 'Adjusted feed ranking weights')}>
              Save weights
            </button>
            {dirty && <button className="btn ghost" onClick={() => value && setDraft(value)}>Reset</button>}
            <div className="tiny muted" style={{ marginLeft: 'auto' }}>
              Takes effect on the next feed request for every user.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Feature flags ──────────────────────────────────────────────── */
function Flags({ value, meta, readOnly, onSave }: {
  value: Record<string, boolean>;
  meta?: SettingRow;
  readOnly: boolean;
  onSave: (v: Record<string, boolean>, reason: string) => Promise<unknown>;
}) {
  const [newName, setNewName] = useState('');
  const entries = Object.entries(value);
  const nameOk = /^[a-z0-9_]{2,40}$/.test(newName);

  return (
    <div className="panel">
      <div className="panel-head">
        <Flag size={15} />
        <div>
          <div className="panel-title">Feature flags</div>
          <div className="panel-sub">
            {meta?.updated_at ? `Last changed ${fmtDateTime(meta.updated_at)}` : 'Never changed'}
          </div>
        </div>
      </div>

      <div className="panel-body stack">
        {entries.length === 0 && <div className="small muted">No flags yet.</div>}

        {entries.map(([name, on]) => (
          <div className="row" key={name}>
            <code className="mono">{name}</code>
            <div className="spacer" />
            <Badge tone={on ? 'ok' : 'neutral'}>{on ? 'on' : 'off'}</Badge>
            {!readOnly && (
              <>
                <button className="btn sm" onClick={() => onSave({ ...value, [name]: !on }, `Toggled ${name}`)}>
                  Turn {on ? 'off' : 'on'}
                </button>
                <button className="btn sm ghost" aria-label={`Remove ${name}`}
                  onClick={() => {
                    const next = { ...value };
                    delete next[name];
                    onSave(next, `Removed flag ${name}`);
                  }}>
                  <Trash2 size={12} />
                </button>
              </>
            )}
          </div>
        ))}

        {!readOnly && (
          <div className="row" style={{ paddingTop: 6, borderTop: '1px solid var(--line)' }}>
            <input className="input" style={{ width: 240 }} value={newName} placeholder="new_flag_name"
              onChange={(e) => setNewName(e.target.value.toLowerCase())} spellCheck={false} />
            <button className="btn" disabled={!nameOk || newName in value}
              onClick={() => { onSave({ ...value, [newName]: false }, `Added flag ${newName}`); setNewName(''); }}>
              <Plus size={13} /> Add
            </button>
            {newName && !nameOk && (
              <span className="tiny" style={{ color: 'var(--danger)' }}>Lowercase letters, digits and underscores, 2–40 characters.</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Maintenance ────────────────────────────────────────────────── */
function Maintenance({ value, readOnly, onSave }: {
  value?: MaintenanceMode;
  readOnly: boolean;
  onSave: (v: MaintenanceMode, reason: string) => Promise<unknown>;
}) {
  const [message, setMessage] = useState('');
  const [confirming, setConfirming] = useState(false);
  useEffect(() => { if (value) setMessage(value.message); }, [value]);

  if (!value) return null;

  return (
    <div className="panel">
      <div className="panel-head">
        <AlertTriangle size={15} color={value.enabled ? 'var(--danger)' : undefined} />
        <div>
          <div className="panel-title">Maintenance mode</div>
          <div className="panel-sub">Returns 503 to the app while it is on</div>
        </div>
        <div className="panel-actions">
          <Badge tone={value.enabled ? 'danger' : 'ok'} dot>{value.enabled ? 'ON' : 'Off'}</Badge>
        </div>
      </div>

      <div className="panel-body stack">
        {value.enabled && (
          <div className="consequence">
            <AlertTriangle size={14} />
            <div>The app is showing a maintenance screen to every user right now.</div>
          </div>
        )}

        <div className="field">
          <label className="field-label" htmlFor="m-msg">What users see</label>
          <textarea id="m-msg" className="textarea" value={message} maxLength={300} disabled={readOnly}
            onChange={(e) => setMessage(e.target.value)} />
        </div>

        {!readOnly && (
          <div className="btn-row">
            {value.enabled ? (
              <button className="btn primary" onClick={() => onSave({ ...value, enabled: false, message }, 'Ended maintenance')}>
                Turn maintenance off
              </button>
            ) : (
              <button className="btn danger" onClick={() => setConfirming(true)}>Turn maintenance on</button>
            )}
            {message !== value.message && (
              <button className="btn" onClick={() => onSave({ ...value, message }, 'Updated maintenance message')}>
                Save message
              </button>
            )}
            <div className="tiny muted" style={{ marginLeft: 'auto' }}>
              Health checks, this console and sign-in stay up.
            </div>
          </div>
        )}
      </div>

      {confirming && (
        <ConfirmAction
          title="Turn maintenance mode on"
          target="Every user of the app"
          consequence="The API starts returning 503 to the app immediately. Health checks, this console and /api/auth stay up so you can turn it back off."
          confirmLabel="Turn it on"
          minReason={10}
          onConfirm={(reason) => onSave({ ...value, enabled: true, message }, reason)}
          onClose={() => setConfirming(false)}
        />
      )}
    </div>
  );
}
