"use client";

import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play, RefreshCw } from "lucide-react";
import type { FeedPageDTO } from "@/domain/dto";
import { apiFetch, qs } from "@/lib/client/api";
import { useStream } from "@/components/providers/app-providers";
import { EventPreview } from "@/components/feed/event-preview";
import { FeedFilters, filterQuery, useFilterState } from "@/components/feed/filters";
import { FeedRow } from "@/components/feed/feed-row";
import { useEventActions } from "@/components/feed/use-event-actions";
import { Button, EmptyState, ErrorState, PageHeader, SkeletonRows } from "@/components/ui/primitives";

function FeedView() {
  const { state, update, clear, activeCount } = useFilterState();
  const query = useMemo(() => filterQuery(state, { limit: 30 }), [state]);
  const key = ["feed", "live", query] as const;
  const feed = useInfiniteQuery({
    queryKey: key,
    queryFn: ({ pageParam, signal }) => apiFetch<FeedPageDTO>(`/api/feed${qs({ ...query, cursor: pageParam ?? undefined })}`, { signal }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });
  const qc = useQueryClient();
  const router = useRouter();
  const { subscribe, connection } = useStream();
  const { toggleSaved, toggleReviewed } = useEventActions();
  const [paused, setPaused] = useState(false);
  const [pending, setPending] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const seen = useRef<Set<string> | null>(null);
  const [newIds, setNewIds] = useState<Set<string>>(new Set());

  const items = useMemo(() => {
    const out = new Map<string, FeedPageDTO["items"][number]>();
    for (const p of feed.data?.pages ?? []) for (const it of p.items) if (!out.has(it.id)) out.set(it.id, it);
    return [...out.values()];
  }, [feed.data]);

  // Highlight rows that appear after the first load.
  useEffect(() => {
    if (!feed.data) return;
    if (seen.current === null) {
      seen.current = new Set(items.map((i) => i.id));
      return;
    }
    const fresh = items.filter((i) => !seen.current!.has(i.id)).map((i) => i.id);
    fresh.forEach((id) => seen.current!.add(id));
    if (fresh.length) setNewIds(new Set(fresh));
  }, [items, feed.data]);

  // Live updates: refetch loaded pages unless paused.
  const pausedRef = useRef(paused);
  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsub = subscribe((e) => {
      if (e.type !== "event") return;
      if (pausedRef.current) {
        setPending((n) => n + 1);
        return;
      }
      clearTimeout(timer);
      timer = setTimeout(() => void qc.invalidateQueries({ queryKey: ["feed", "live"] }), 1_200);
    });
    return () => {
      clearTimeout(timer);
      unsub();
    };
  }, [subscribe, qc]);

  const resume = () => {
    setPaused(false);
    setPending(0);
    void qc.invalidateQueries({ queryKey: ["feed", "live"] });
  };

  // Infinite scroll sentinel.
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && feed.hasNextPage && !feed.isFetchingNextPage) void feed.fetchNextPage();
    });
    io.observe(el);
    return () => io.disconnect();
  }, [feed]);

  const onSelect = (id: string) => {
    if (typeof window !== "undefined" && window.matchMedia("(min-width: 1280px)").matches) setSelected(id);
    else router.push(`/events/${id}`);
  };

  return (
    <div className="flex flex-col gap-3">
      <PageHeader
        title="Live Feed"
        description="Detected events from collected posts and official feeds. Importance prioritises research; confidence reflects evidence strength. Neither predicts price movement."
        actions={
          <>
            {paused ? (
              <Button size="sm" variant="accent" icon={<Play className="size-3.5" />} onClick={resume} data-testid="resume-feed">
                Resume{pending > 0 ? ` · ${pending} update${pending === 1 ? "" : "s"}` : ""}
              </Button>
            ) : (
              <Button size="sm" variant="secondary" icon={<Pause className="size-3.5" />} onClick={() => setPaused(true)} data-testid="pause-feed">
                Pause live updates
              </Button>
            )}
            <Button size="sm" variant="ghost" icon={<RefreshCw className={feed.isFetching ? "size-3.5 animate-spin" : "size-3.5"} />} onClick={() => feed.refetch()}>
              Refresh
            </Button>
          </>
        }
      />
      <FeedFilters state={state} update={update} clear={clear} activeCount={activeCount} />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 overflow-hidden rounded-lg border border-line bg-surface">
          {feed.isLoading ? (
            <SkeletonRows rows={8} />
          ) : feed.error ? (
            <div className="p-4">
              <ErrorState error={feed.error} onRetry={() => feed.refetch()} />
            </div>
          ) : items.length === 0 ? (
            <EmptyState
              title={activeCount ? "No events match these filters" : "No events yet"}
              description={
                activeCount ? (
                  "Try removing some filters."
                ) : connection?.mode === "awaiting_configuration" ? (
                  "No live data source is configured, so nothing is being collected. See Settings → Integrations. Demo mode (DEMO_MODE=true) can show clearly labelled sample data."
                ) : connection?.mode === "disconnected" ? (
                  "Sources are configured but not delivering data right now. A collection failure is not evidence that nothing happened — check System Status."
                ) : (
                  "Collection is running. Events appear here when posts or feed entries pass the relevance filters."
                )
              }
            />
          ) : (
            <div role="feed" aria-busy={feed.isFetching} data-testid="feed-list">
              {items.map((e) => (
                <FeedRow
                  key={e.id}
                  event={e}
                  selected={selected === e.id}
                  isNew={newIds.has(e.id)}
                  onSelect={onSelect}
                  onToggleSaved={toggleSaved}
                  onToggleReviewed={toggleReviewed}
                />
              ))}
              <div ref={sentinel} className="h-8" />
              {feed.isFetchingNextPage && <p className="py-3 text-center text-xs text-fg-3">Loading more…</p>}
              {!feed.hasNextPage && items.length > 10 && <p className="py-3 text-center text-2xs text-fg-3">End of results</p>}
            </div>
          )}
        </div>
        <aside className="sticky top-16 hidden max-h-[calc(100vh-5rem)] overflow-y-auto rounded-lg border border-line bg-surface xl:block" aria-label="Event details">
          <EventPreview id={selected} />
        </aside>
      </div>
    </div>
  );
}

export default function FeedPage() {
  return (
    <Suspense fallback={<SkeletonRows rows={8} />}>
      <FeedView />
    </Suspense>
  );
}
