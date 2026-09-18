import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Star, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { PageBody } from '../components/Shell';
import { Badge, ConfirmAction, Empty, ErrorBox, Pager, SkeletonRows, useCursorPager, useToast } from '../components/ui';
import { fmtDate, fmtNum, shortId } from '../lib/format';
import type { Paged, RatingRow } from '../lib/types';

interface Suspicious {
  spikes: { brand_id: string; brand_name: string | null; ratings_24h: number; avg_24h: string; ratings_total: number }[];
  prolific_raters: { influencer_id: string; influencer_name: string | null; ratings_given: number; avg_given: string }[];
}

export default function Ratings() {
  const { can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const pager = useCursorPager();

  const [score, setScore] = useState('');
  const [pending, setPending] = useState<RatingRow | null>(null);

  const query = { score: score || undefined, cursor: pager.cursor || undefined, limit: 50 };
  const list = useQuery({
    queryKey: ['ratings', query],
    queryFn: () => api.get<Paged<RatingRow>>('/ratings', query),
  });
  const sus = useQuery({ queryKey: ['ratings', 'suspicious'], queryFn: () => api.get<Suspicious>('/ratings/suspicious') });

  const remove = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api.delete<{ new_average: number | null; new_count: number }>(`/ratings/${id}`, { reason }),
    onSuccess: (res) => {
      toast.success('Rating removed', `The brand now shows ${res.new_average ?? 'no'} from ${fmtNum(res.new_count)}.`);
      qc.invalidateQueries({ queryKey: ['ratings'] });
    },
    onError: toast.error,
  });

  const rows = list.data?.data ?? [];
  const hasSignals = (sus.data?.spikes.length ?? 0) > 0 || (sus.data?.prolific_raters.length ?? 0) > 0;

  return (
    <PageBody wide>
      <div className="stack">
        {hasSignals && (
          <div className="panel">
            <div className="panel-head">
              <AlertTriangle size={15} color="var(--warn)" />
              <div>
                <div className="panel-title">Worth a look</div>
                <div className="panel-sub">Not proof of anything — just patterns a human should check</div>
              </div>
            </div>
            <div className="panel-body grid c2">
              {sus.data!.spikes.length > 0 && (
                <div>
                  <div className="stat-label" style={{ marginBottom: 7 }}>Brands with a rating spike in 24h</div>
                  <table className="tbl">
                    <tbody>
                      {sus.data!.spikes.map((s) => (
                        <tr key={s.brand_id}>
                          <td className="truncate">{s.brand_name ?? shortId(s.brand_id)}</td>
                          <td className="num"><b>{s.ratings_24h}</b> <span className="muted">in 24h</span></td>
                          <td className="num muted">avg {s.avg_24h}</td>
                          <td className="num muted">{fmtNum(s.ratings_total)} total</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {sus.data!.prolific_raters.length > 0 && (
                <div>
                  <div className="stat-label" style={{ marginBottom: 7 }}>Creators rating a lot of brands</div>
                  <table className="tbl">
                    <tbody>
                      {sus.data!.prolific_raters.map((p) => (
                        <tr key={p.influencer_id}>
                          <td className="truncate">{p.influencer_name ?? shortId(p.influencer_id)}</td>
                          <td className="num"><b>{p.ratings_given}</b> <span className="muted">ratings</span></td>
                          <td className="num muted">avg {p.avg_given}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        <div className="panel">
          <div className="panel-head">
            <div className="panel-title">All ratings</div>
            <div className="panel-actions">
              <select className="select" style={{ width: 130 }} value={score}
                onChange={(e) => { setScore(e.target.value); pager.reset(); }}>
                <option value="">Any score</option>
                {[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n} star{n > 1 ? 's' : ''}</option>)}
              </select>
            </div>
          </div>

          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Brand</th>
                  <th>Rated by</th>
                  <th style={{ width: 110 }}>Score</th>
                  <th style={{ width: 120 }}>Given</th>
                  <th style={{ width: 70 }} />
                </tr>
              </thead>
              {list.isLoading ? <SkeletonRows rows={8} cols={5} /> : (
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td className="truncate" style={{ maxWidth: 260 }}>{r.brand_name ?? shortId(r.brand_id)}</td>
                      <td className="truncate" style={{ maxWidth: 260 }}>{r.influencer_name ?? shortId(r.influencer_id)}</td>
                      <td>
                        <Badge tone={r.score >= 4 ? 'ok' : r.score <= 2 ? 'danger' : 'warn'}>
                          {r.score} / 5
                        </Badge>
                      </td>
                      <td className="muted">{fmtDate(r.created_at)}</td>
                      <td>
                        {can('ratings:delete') && (
                          <button className="btn sm danger" onClick={() => setPending(r)} aria-label="Remove rating">
                            <Trash2 size={12} />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              )}
            </table>

            {list.isError && <ErrorBox error={list.error} onRetry={() => list.refetch()} />}
            {!list.isLoading && rows.length === 0 && (
              <Empty icon={<Star size={22} />} title="No ratings" text="No creator has rated a brand yet." />
            )}
          </div>

          <div className="panel-head" style={{ borderTop: '1px solid var(--line)', borderBottom: 'none' }}>
            <Pager pager={pager} nextCursor={list.data?.next_cursor ?? null} count={rows.length} />
          </div>
        </div>
      </div>

      {pending && (
        <ConfirmAction
          title="Remove this rating"
          target={`${pending.score}/5 for ${pending.brand_name ?? pending.brand_id} from ${pending.influencer_name ?? pending.influencer_id}`}
          consequence="The brand's average and count are recalculated immediately and their cached profile is cleared. This cannot be undone."
          confirmLabel="Remove rating"
          onConfirm={(reason) => remove.mutateAsync({ id: pending.id, reason })}
          onClose={() => setPending(null)}
        />
      )}
    </PageBody>
  );
}
