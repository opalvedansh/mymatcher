import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Image as ImageIcon, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { PageBody } from '../components/Shell';
import { Badge, ConfirmAction, Empty, ErrorBox, Pager, SkeletonBlock, useCursorPager, useToast } from '../components/ui';
import { fmtNum, fmtRelative, shortId } from '../lib/format';
import type { Paged, PostRow, StoryRow } from '../lib/types';

type Tab = 'posts' | 'stories';

export default function Content() {
  const { can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const pager = useCursorPager();

  const [tab, setTab] = useState<Tab>('posts');
  const [includeExpired, setIncludeExpired] = useState(false);
  const [pending, setPending] = useState<{ kind: Tab; id: string; label: string } | null>(null);

  const query = {
    cursor: pager.cursor || undefined,
    limit: 40,
    ...(tab === 'stories' ? { include_expired: includeExpired ? 'true' : undefined } : {}),
  };

  const list = useQuery({
    queryKey: ['content', tab, query],
    queryFn: () => api.get<Paged<PostRow | StoryRow>>(`/${tab}`, query),
  });

  const remove = useMutation({
    mutationFn: ({ kind, id, reason }: { kind: Tab; id: string; reason: string }) =>
      api.delete<{ storage_removed: boolean }>(`/${kind}/${id}`, { reason }),
    onSuccess: (res) => {
      toast.success('Deleted', res.storage_removed ? 'The uploaded file was removed too.' : 'The row is gone; the file could not be removed.');
      qc.invalidateQueries({ queryKey: ['content'] });
    },
    onError: toast.error,
  });

  const rows = list.data?.data ?? [];

  return (
    <PageBody wide>
      <div className="stack">
        <div className="row">
          <div className="tabs" style={{ border: 'none' }}>
            <button className={`tab${tab === 'posts' ? ' active' : ''}`} onClick={() => { setTab('posts'); pager.reset(); }}>Posts</button>
            <button className={`tab${tab === 'stories' ? ' active' : ''}`} onClick={() => { setTab('stories'); pager.reset(); }}>Stories</button>
          </div>
          <div className="spacer" />
          {tab === 'stories' && (
            <label className="check small">
              <input type="checkbox" checked={includeExpired}
                onChange={(e) => { setIncludeExpired(e.target.checked); pager.reset(); }} />
              Include expired
            </label>
          )}
        </div>

        {list.isLoading && <SkeletonBlock height={280} />}
        {list.isError && <ErrorBox error={list.error} onRetry={() => list.refetch()} />}

        {!list.isLoading && rows.length === 0 && (
          <div className="panel">
            <Empty
              icon={<ImageIcon size={22} />}
              title={`No ${tab}`}
              text={tab === 'stories' && !includeExpired
                ? 'Nothing is live right now. Stories are never deleted, only hidden after 24 hours — tick "include expired" to see the archive.'
                : `Nobody has published a ${tab.slice(0, -1)} yet.`}
            />
          </div>
        )}

        {rows.length > 0 && (
          <>
            <div className="media-grid">
              {rows.map((row) => {
                const isPost = 'image_url' in row;
                const url = isPost ? (row as PostRow).image_url : (row as StoryRow).media_url;
                const expired = !isPost && (row as StoryRow).expired;

                return (
                  <div className="media-tile" key={row.id}>
                    <a href={url} target="_blank" rel="noreferrer noopener">
                      <img src={url} alt="" loading="lazy" />
                    </a>
                    <div className="media-meta">
                      <div className="truncate strong">{row.author_name ?? shortId(row.user_id)}</div>
                      {isPost && (row as PostRow).caption && (
                        <div className="tiny muted truncate">{(row as PostRow).caption}</div>
                      )}
                      <div className="row" style={{ gap: 5, flexWrap: 'wrap' }}>
                        {row.report_count > 0 && <Badge tone="danger">{row.report_count} reports</Badge>}
                        {expired && <Badge>Expired</Badge>}
                        {isPost && <Badge>{fmtNum((row as PostRow).likes_count)} likes</Badge>}
                        {!isPost && <Badge>{fmtNum((row as StoryRow).view_count)} views</Badge>}
                      </div>
                      <div className="row">
                        <span className="tiny muted">{fmtRelative(row.created_at)}</span>
                        {can('content:delete') && (
                          <button
                            className="btn sm danger"
                            style={{ marginLeft: 'auto' }}
                            onClick={() => setPending({
                              kind: tab, id: row.id,
                              label: `${tab.slice(0, -1)} by ${row.author_name ?? shortId(row.user_id)}`,
                            })}
                          >
                            <Trash2 size={12} />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="panel"><div className="panel-head" style={{ borderBottom: 'none' }}>
              <Pager pager={pager} nextCursor={list.data?.next_cursor ?? null} count={rows.length} />
            </div></div>
          </>
        )}
      </div>

      {pending && (
        <ConfirmAction
          title="Delete this content"
          target={pending.label}
          consequence="Removes the row and, when the file belongs to that user, the uploaded object in storage. This cannot be undone."
          confirmLabel="Delete"
          onConfirm={(reason) => remove.mutateAsync({ kind: pending.kind, id: pending.id, reason })}
          onClose={() => setPending(null)}
        />
      )}
    </PageBody>
  );
}
