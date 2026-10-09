"use client";

import Link from "next/link";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Suspense, useMemo } from "react";
import type { FeedPageDTO } from "@/domain/dto";
import { categoryLabel } from "@/domain/categories";
import { apiFetch, qs } from "@/lib/client/api";
import { FeedFilters, filterQuery, useFilterState } from "@/components/feed/filters";
import { bandTone, DemoBadge, TickerChip, VerificationBadge } from "@/components/ui/badges";
import { Button, EmptyState, ErrorState, PageHeader, SkeletonRows } from "@/components/ui/primitives";
import { Timestamp } from "@/components/ui/time";

type HistoryPage = FeedPageDTO & { coverage: { firstCollectionAt: string | null; complete: boolean } };

function HistoryView() {
  const { state, update, clear, activeCount } = useFilterState();
  const query = useMemo(() => filterQuery(state, { limit: 50 }), [state]);
  const q = useInfiniteQuery({
    queryKey: ["feed", "history", query],
    queryFn: ({ pageParam, signal }) => apiFetch<HistoryPage>(`/api/history${qs({ ...query, cursor: pageParam ?? undefined })}`, { signal }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });
  const rows = q.data?.pages.flatMap((p) => p.items) ?? [];
  const coverage = q.data?.pages[0]?.coverage;

  return (
    <div className="flex flex-col gap-3">
      <PageHeader
        title="Historical Events"
        description={
          <>
            Searchable archive of detected events with their score histories. Coverage is limited to what this installation collected
            {coverage?.firstCollectionAt ? (
              <>
                {" "}
                since <Timestamp value={coverage.firstCollectionAt} dateOnly />
              </>
            ) : null}
            . It is not a complete historical record, and raw source text may have been removed under provider retention rules.
          </>
        }
      />
      <FeedFilters state={state} update={update} clear={clear} activeCount={activeCount} showDateRange />
      <div className="overflow-hidden rounded-lg border border-line bg-surface">
        {q.isLoading ? (
          <SkeletonRows rows={10} />
        ) : q.error ? (
          <div className="p-4">
            <ErrorState error={q.error} onRetry={() => q.refetch()} />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState title="No events in the archive match" description={activeCount ? "Adjust the filters or date range." : "The archive fills as events are detected."} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-xs" data-testid="history-table">
              <thead className="border-b border-line bg-elevated/40 text-left text-2xs uppercase tracking-wider text-fg-3">
                <tr>
                  <th className="px-3 py-2 font-medium">Published</th>
                  <th className="px-3 py-2 font-medium">Event</th>
                  <th className="px-3 py-2 font-medium">Category</th>
                  <th className="px-3 py-2 font-medium">Verification</th>
                  <th className="px-3 py-2 text-right font-medium">Imp</th>
                  <th className="px-3 py-2 text-right font-medium">Conf</th>
                  <th className="px-3 py-2 font-medium">Assets</th>
                  <th className="px-3 py-2 text-right font-medium">Src / indep</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-subtle">
                {rows.map((e) => (
                  <tr key={e.id} className="align-top hover:bg-hover/60">
                    <td className="whitespace-nowrap px-3 py-2">
                      <Timestamp value={e.firstPublishedAt ?? e.firstSeenAt} className="text-fg-2" />
                    </td>
                    <td className="max-w-md px-3 py-2">
                      <Link href={`/events/${e.id}`} className="line-clamp-2 text-fg hover:text-accent">
                        {e.title}
                      </Link>
                      <span className="mt-0.5 flex items-center gap-1.5 font-mono text-2xs text-fg-3">
                        {e.ref} {e.isDemo && <DemoBadge />}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-fg-2">{categoryLabel(e.primaryCategory)}</td>
                    <td className="px-3 py-2">
                      <VerificationBadge status={e.verificationStatus} />
                    </td>
                    <td className={`px-3 py-2 text-right font-mono font-semibold ${bandTone(e.importance).text}`}>{e.importance}</td>
                    <td className="px-3 py-2 text-right font-mono text-fg-2">{e.confidence}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        {e.assets.length ? e.assets.slice(0, 4).map((a) => <TickerChip key={a.symbol} symbol={a.symbol} relation={a.relation} />) : <span className="text-fg-3">unknown</span>}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-fg-3">
                      {e.sourceCount} / {e.independentSourceCount}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {q.hasNextPage && (
              <div className="border-t border-line-subtle p-3 text-center">
                <Button size="sm" onClick={() => q.fetchNextPage()} loading={q.isFetchingNextPage}>
                  Load more
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function HistoryPage() {
  return (
    <Suspense fallback={<SkeletonRows rows={10} />}>
      <HistoryView />
    </Suspense>
  );
}
