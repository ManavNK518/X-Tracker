"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, ScanSearch } from "lucide-react";
import type { EventDetailDTO } from "@/domain/dto";
import { ITEM_ROLE_LABELS, type ItemRole } from "@/domain/misc";
import { apiFetch } from "@/lib/client/api";
import { bandTone, CategoryTag, ConfidenceScore, DemoBadge, ImportanceScore, ScoreBar, TickerChip, VerificationBadge } from "@/components/ui/badges";
import { Button, ErrorState, Skeleton } from "@/components/ui/primitives";
import { Timestamp } from "@/components/ui/time";

export function EventPreview({ id }: { id: string | null }) {
  const q = useQuery({
    queryKey: ["event", id],
    queryFn: () => apiFetch<EventDetailDTO>(`/api/events/${id}`),
    enabled: Boolean(id),
  });
  if (!id) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-xs text-fg-3">
        Select an event to see its evidence, scores and verification status.
      </div>
    );
  }
  if (q.isLoading) {
    return (
      <div className="space-y-3 p-4">
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-5 w-full" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }
  if (q.error || !q.data) return <div className="p-4"><ErrorState error={q.error} onRetry={() => q.refetch()} /></div>;
  const e = q.data;
  return (
    <div className="space-y-4 p-4" data-testid="event-preview">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-mono text-2xs text-fg-3">{e.ref}</span>
        {e.isDemo && <DemoBadge />}
        <VerificationBadge status={e.verificationStatus} />
        <CategoryTag category={e.primaryCategory} />
      </div>
      <h2 className="text-sm font-semibold leading-snug">{e.title}</h2>

      <div className="grid grid-cols-2 gap-3 rounded-md border border-line-subtle p-3">
        <div className="space-y-1.5">
          <ImportanceScore value={e.importance} coverage={e.importanceCoverage} />
          <ScoreBar value={e.importance} coverage={e.importanceCoverage} />
          <p className="text-2xs text-fg-3">
            {bandTone(e.importance).band} · coverage {Math.round(e.importanceCoverage * 100)}%
          </p>
        </div>
        <div className="space-y-1.5">
          <ConfidenceScore value={e.confidence} />
          <ScoreBar value={e.confidence} coverage={e.confidenceCoverage} tone="positive" />
          <p className="text-2xs text-fg-3">evidence strength · coverage {Math.round(e.confidenceCoverage * 100)}%</p>
        </div>
      </div>

      <section>
        <h3 className="mb-1 text-2xs font-semibold uppercase tracking-wider text-fg-3">Verified</h3>
        <ul className="space-y-1 text-xs text-fg-2">
          {e.explanation.verified.map((v, i) => (
            <li key={i}>• {v}</li>
          ))}
        </ul>
        {e.explanation.unverified.length > 0 && (
          <>
            <h3 className="mb-1 mt-3 text-2xs font-semibold uppercase tracking-wider text-fg-3">Uncertain / unverified</h3>
            <ul className="space-y-1 text-xs text-fg-2">
              {e.explanation.unverified.slice(0, 3).map((v, i) => (
                <li key={i}>• {v}</li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section>
        <h3 className="mb-1.5 text-2xs font-semibold uppercase tracking-wider text-fg-3">
          Sources · {e.sourceCount} items / {e.independentSourceCount} independent
        </h3>
        <ul className="space-y-2">
          {e.explanation.statements.slice(0, 4).map((s) => (
            <li key={s.itemId} className="rounded border border-line-subtle p-2">
              <div className="flex items-center justify-between gap-2 text-2xs">
                <span className="font-medium text-fg-2">{s.sourceName}</span>
                <span className="text-fg-3">{ITEM_ROLE_LABELS[s.role as ItemRole] ?? s.role}</span>
              </div>
              <p className="mt-1 line-clamp-3 text-xs text-fg-2">“{s.excerpt}”</p>
              <div className="mt-1 flex items-center justify-between text-2xs text-fg-3">
                <Timestamp value={s.publishedAt} />
                {s.url ? (
                  <a href={s.url} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 hover:text-fg">
                    source <ExternalLink className="size-3" />
                  </a>
                ) : (
                  <span>no link</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h3 className="mb-1.5 text-2xs font-semibold uppercase tracking-wider text-fg-3">Potentially affected assets</h3>
        {e.assetDetails.length ? (
          <div className="flex flex-wrap gap-1">
            {e.assetDetails.slice(0, 10).map((a) => (
              <TickerChip key={a.symbol} symbol={a.symbol} relation={a.relation} title={`${a.name}: ${a.rationale}`} />
            ))}
          </div>
        ) : (
          <p className="text-xs text-fg-3">Unknown — no asset could be identified confidently.</p>
        )}
      </section>

      <Link href={`/events/${e.id}`}>
        <Button variant="accent" className="w-full" icon={<ScanSearch className="size-4" />}>
          Open full investigation
        </Button>
      </Link>
    </div>
  );
}
