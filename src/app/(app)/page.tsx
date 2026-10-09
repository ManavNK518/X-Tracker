"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ArrowRight } from "lucide-react";
import { categoryLabel } from "@/domain/categories";
import type { ConnectionStateDTO, FeedEventDTO, NotificationDTO } from "@/domain/dto";
import { apiFetch } from "@/lib/client/api";
import { formatDateTime } from "@/lib/time";
import { EventMini } from "@/components/feed/event-mini";
import { DemoBadge, StatusDot, VerificationBadge } from "@/components/ui/badges";
import { BarList, ColumnChart } from "@/components/ui/charts";
import { EmptyState, ErrorState, PageHeader, Panel, Skeleton } from "@/components/ui/primitives";
import { Timestamp, useTimeZone } from "@/components/ui/time";

interface Overview {
  period: "24h" | "7d";
  generatedAt: string;
  counts: { events: number; highPriority: number; verified: number; disputed: number; itemsCollected: number; itemsFiltered: number };
  latestHighPriority: FeedEventDTO[];
  recentVerified: FeedEventDTO[];
  macro: FeedEventDTO[];
  themes: { category: string; count: number; avgImportance: number }[];
  topAssets: { symbol: string; name: string; count: number }[];
  volume: { bucketStart: string; events: number; notifications: number }[];
  watchlistAlerts: NotificationDTO[];
  activity: { at: string; kind: "event" | "run"; text: string; ref: string | null; href: string; status: string; isDemo: boolean; importance: number | null }[];
  connection: ConnectionStateDTO;
  firstCollectionAt: string | null;
}

function Stat({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface px-4 py-3" title={hint}>
      <p className="text-2xs text-fg-3">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight text-fg">{value.toLocaleString()}</p>
    </div>
  );
}

function ListOrEmpty({ events, empty }: { events: FeedEventDTO[]; empty: string }) {
  if (!events.length) return <p className="px-2 py-6 text-center text-xs text-fg-3">{empty}</p>;
  return (
    <div className="-mx-2">
      {events.map((e) => (
        <EventMini key={e.id} e={e} />
      ))}
    </div>
  );
}

export default function OverviewPage() {
  const [period, setPeriod] = useState<"24h" | "7d">("24h");
  const tz = useTimeZone();
  const q = useQuery({ queryKey: ["overview", period], queryFn: () => apiFetch<Overview>(`/api/overview?period=${period}`), refetchInterval: 60_000 });

  const periodToggle = (
    <div className="inline-flex rounded-md border border-line p-0.5 text-xs" role="group" aria-label="Period">
      {(["24h", "7d"] as const).map((p) => (
        <button key={p} aria-pressed={period === p} onClick={() => setPeriod(p)} className={`rounded px-2.5 py-0.5 ${period === p ? "bg-accent-soft text-fg" : "text-fg-3 hover:text-fg"}`}>
          {p === "24h" ? "Last 24 hours" : "Last 7 days"}
        </button>
      ))}
    </div>
  );

  if (q.isLoading) {
    return (
      <div className="space-y-4">
        <PageHeader title="Overview" actions={periodToggle} />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-[68px]" />
          ))}
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const o = q.data;
  const nothing = o.counts.events === 0 && o.counts.itemsCollected === 0;
  const hourly = period === "24h";
  const volumeData = (series: "events" | "notifications") =>
    o.volume.map((b) => {
      const d = formatDateTime(b.bucketStart, tz);
      return { key: b.bucketStart, label: hourly ? d.slice(11, 13) : d.slice(5, 10), detail: hourly ? `${d.slice(0, 13)}:00` : d.slice(0, 10), value: b[series] };
    });

  return (
    <div className="space-y-4" data-testid="overview">
      <PageHeader
        title="Overview"
        description={
          <>
            Current intelligence environment. Counts come from data collected by this installation
            {o.firstCollectionAt ? (
              <>
                {" "}
                since <Timestamp value={o.firstCollectionAt} dateOnly />
              </>
            ) : null}
            ; they are not a complete record of market events.
          </>
        }
        actions={periodToggle}
      />

      {nothing && (
        <Panel>
          <EmptyState
            title="No data collected yet"
            description={
              o.connection.mode === "awaiting_configuration"
                ? "No live source is configured. Enable official RSS feeds or configure the X API in your environment (see Settings → Integrations). Nothing below is filled with placeholder data."
                : o.connection.workerAlive
                  ? "The worker is running. Statistics appear once collected items pass the relevance filters."
                  : "The background worker is not running, so nothing is being collected."
            }
            action={
              <Link href="/settings?tab=integrations" className="text-xs text-accent hover:underline">
                Open integration setup
              </Link>
            }
          />
        </Panel>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6" data-testid="overview-stats">
        <Stat label="Events detected" value={o.counts.events} />
        <Stat label="High priority (≥ 60)" value={o.counts.highPriority} />
        <Stat label="Confirmed or corroborated" value={o.counts.verified} hint="Confirmed, independently corroborated, or primary source located" />
        <Stat label="Disputed or corrected" value={o.counts.disputed} />
        <Stat label="Items collected" value={o.counts.itemsCollected} />
        <Stat label="Filtered or duplicate" value={o.counts.itemsFiltered} hint="Spam, low-information, irrelevant or duplicate items" />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Panel
          title="Latest high-priority events"
          className="xl:col-span-2"
          actions={
            <Link href="/feed?sort=importance&minImportance=60" className="inline-flex items-center gap-1 text-2xs text-fg-3 hover:text-fg">
              Feed <ArrowRight className="size-3" />
            </Link>
          }
        >
          <ListOrEmpty events={o.latestHighPriority} empty="No events scored ≥ 60 in this window." />
        </Panel>
        <Panel title="Source connectivity" subtitle={o.connection.workerAlive ? "Worker running" : "Worker not running — collection paused"}>
          <ul className="space-y-2.5">
            {o.connection.providers.map((p) => (
              <li key={p.provider} className="text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 text-fg">
                    <StatusDot status={p.status === "connected" ? "ok" : p.status === "error" || p.status === "worker_offline" ? "error" : p.configured ? "warn" : "off"} />
                    {p.label}
                  </span>
                  <span className="font-mono text-2xs text-fg-3">{p.status.replace(/_/g, " ")}</span>
                </div>
                <p className="ml-3.5 mt-0.5 text-2xs text-fg-3">
                  {p.provider === "demo" && p.configured ? "Sample data only" : p.origin}
                  {p.lastSuccessAt && (
                    <>
                      {" "}
                      · last success <Timestamp value={p.lastSuccessAt} />
                    </>
                  )}
                </p>
                {p.lastError && p.status !== "connected" && <p className="ml-3.5 mt-0.5 line-clamp-2 text-2xs text-negative">{p.lastError}</p>}
              </li>
            ))}
          </ul>
          <Link href="/status" className="mt-3 inline-flex items-center gap-1 text-2xs text-fg-3 hover:text-fg">
            System status <ArrowRight className="size-3" />
          </Link>
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Panel title="Event & alert volume" className="xl:col-span-2" subtitle={`Per ${hourly ? "hour" : "day"}, ${tz}`}>
          <div className="grid gap-4 md:grid-cols-2">
            <ColumnChart title="Events detected" unit="events" data={volumeData("events")} labelEvery={hourly ? 6 : 1} color="var(--chart-1)" />
            <ColumnChart title="Your alerts" unit="alerts" data={volumeData("notifications")} labelEvery={hourly ? 6 : 1} color="var(--chart-2)" />
          </div>
        </Panel>
        <Panel title="Alerts by category" subtitle="Events detected in this window, by primary category">
          <BarList unit="events" empty="No events in this window." items={o.themes.map((t) => ({ key: t.category, label: categoryLabel(t.category), value: t.count, href: `/feed?categories=${t.category}` }))} />
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <Panel title="Recent verified developments" subtitle="Confirmed or independently corroborated">
          <ListOrEmpty events={o.recentVerified} empty="No confirmed or corroborated events yet." />
        </Panel>
        <Panel title="Recent macroeconomic events" subtitle="Monetary policy & economic data">
          <ListOrEmpty events={o.macro} empty="No macro events in this window." />
        </Panel>
        <Panel
          title="Watchlist alerts"
          actions={
            <Link href="/alerts" className="inline-flex items-center gap-1 text-2xs text-fg-3 hover:text-fg">
              All <ArrowRight className="size-3" />
            </Link>
          }
        >
          {o.watchlistAlerts.length === 0 ? (
            <p className="px-2 py-6 text-center text-xs text-fg-3">
              No alerts yet. Alerts follow your <Link href="/alerts" className="text-accent hover:underline">alert rules</Link> and notifying watchlists.
            </p>
          ) : (
            <ul className="-mx-2">
              {o.watchlistAlerts.map((n) => (
                <li key={n.id}>
                  <Link href={`/events/${n.eventId}`} className="block rounded-md px-2 py-2 hover:bg-hover">
                    <span className="flex items-center gap-1.5 text-2xs text-fg-3">
                      {n.isDemo && <DemoBadge />}
                      <span className="uppercase tracking-wider">{n.kind}</span>
                      <Timestamp value={n.createdAt} />
                    </span>
                    <span className="mt-0.5 line-clamp-2 text-xs text-fg">{n.title}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <Panel title="Active market themes" subtitle="Categories with events in this window (average importance)">
          {o.themes.length === 0 ? (
            <p className="py-4 text-center text-xs text-fg-3">No active themes.</p>
          ) : (
            <ul className="divide-y divide-line-subtle">
              {o.themes.slice(0, 8).map((t) => (
                <li key={t.category} className="flex items-center justify-between py-1.5 text-xs">
                  <Link href={`/feed?categories=${t.category}`} className="text-fg-2 hover:text-fg">
                    {categoryLabel(t.category)}
                  </Link>
                  <span className="font-mono text-2xs text-fg-3">
                    {t.count} · avg {t.avgImportance}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="Most frequently affected assets" subtitle="Directly named assets only">
          <BarList unit="events" empty="No assets identified in this window." items={o.topAssets.map((a) => ({ key: a.symbol, label: a.symbol, sublabel: a.name, value: a.count, href: `/feed?assets=${encodeURIComponent(a.symbol)}` }))} />
        </Panel>
        <Panel title="Recent activity">
          {o.activity.length === 0 ? (
            <p className="py-4 text-center text-xs text-fg-3">No recent activity.</p>
          ) : (
            <ol className="space-y-2">
              {o.activity.map((a, i) => (
                <li key={i} className="flex gap-2 text-xs">
                  <Timestamp value={a.at} timeOnly className="w-10 shrink-0 text-2xs text-fg-3" />
                  <span className="min-w-0 flex-1">
                    {a.kind === "event" ? (
                      <Link href={a.href} className="line-clamp-1 text-fg-2 hover:text-fg">
                        {a.isDemo ? "[sample] " : ""}
                        {a.text}
                      </Link>
                    ) : (
                      <span className={`line-clamp-1 ${a.status === "error" ? "text-negative" : "text-fg-3"}`}>{a.text}</span>
                    )}
                  </span>
                  {a.kind === "event" && <VerificationBadge status={a.status} className="hidden sm:inline-flex" />}
                </li>
              ))}
            </ol>
          )}
        </Panel>
      </div>
    </div>
  );
}
