"use client";

import Link from "next/link";
import { memo } from "react";
import { Bookmark, BookmarkCheck, CheckCheck, ExternalLink, ScanSearch, ShieldAlert } from "lucide-react";
import type { FeedEventDTO } from "@/domain/dto";
import { cn } from "@/lib/client/cn";
import {
  bandTone,
  CategoryTag,
  ConfidenceScore,
  DemoBadge,
  ImportanceScore,
  LifecycleBadge,
  SourceTypeLabel,
  TickerChip,
  VerificationBadge,
} from "@/components/ui/badges";
import { IconButton } from "@/components/ui/primitives";
import { Age, Timestamp } from "@/components/ui/time";

export interface FeedRowProps {
  event: FeedEventDTO;
  selected?: boolean;
  isNew?: boolean;
  onSelect?: (id: string) => void;
  onToggleSaved?: (e: FeedEventDTO) => void;
  onToggleReviewed?: (e: FeedEventDTO) => void;
  compact?: boolean;
}

export const FeedRow = memo(function FeedRow({ event: e, selected, isNew, onSelect, onToggleSaved, onToggleReviewed, compact }: FeedRowProps) {
  const tone = bandTone(e.importance);
  const reviewed = Boolean(e.user.reviewedAt);
  return (
    <article
      data-testid="feed-row"
      data-event-id={e.id}
      data-selected={selected ? "true" : undefined}
      className={cn(
        "feed-row group relative grid grid-cols-[52px_minmax(0,1fr)] gap-x-3 border-b border-line-subtle px-3 py-3 transition-colors md:grid-cols-[56px_48px_minmax(0,1fr)_auto] md:px-4",
        selected ? "bg-elevated" : "hover:bg-hover/60",
        isNew && "row-new",
        reviewed && "opacity-60",
      )}
    >
      <span className={cn("absolute inset-y-0 left-0 w-0.5", tone.bar, e.importance < 60 && "opacity-0")} aria-hidden />
      <div className="pt-0.5">
        <ImportanceScore value={e.importance} coverage={e.importanceCoverage} size="md" short />
      </div>
      <div className="hidden pt-0.5 md:block">
        <ConfidenceScore value={e.confidence} size="md" short />
      </div>

      <div className="min-w-0">
        <div className="mb-1 flex flex-wrap items-center gap-1.5">
          {e.isDemo && <DemoBadge />}
          <LifecycleBadge state={e.lifecycle} />
          <VerificationBadge status={e.verificationStatus} />
          <CategoryTag category={e.primaryCategory} />
          {e.flags.includes("contains_instructions") && (
            <span className="inline-flex items-center gap-1 text-2xs text-warning" title="The source text contains instructions aimed at automated systems. It was treated as untrusted data.">
              <ShieldAlert className="size-3" aria-hidden /> untrusted instructions in text
            </span>
          )}
          <span className="md:hidden">
            <span className="font-mono text-2xs text-fg-3">conf {e.confidence}</span>
          </span>
        </div>
        <button type="button" onClick={() => onSelect?.(e.id)} className="block w-full text-left">
          <h3 className={cn("text-sm font-medium leading-snug text-fg", !compact && "line-clamp-2")}>{e.title}</h3>
        </button>
        {!compact && e.origin?.excerpt && e.origin.excerpt !== e.title && (
          <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-fg-2">{e.origin.excerpt}</p>
        )}
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-2xs text-fg-3">
          {e.origin && (
            <>
              <span className="font-medium text-fg-2">{e.origin.sourceName}</span>
              {e.origin.handle && e.origin.provider !== "rss" && <span className="font-mono">@{e.origin.handle}</span>}
              {e.origin.registered ? <SourceTypeLabel category={e.origin.sourceCategory} /> : <span className="text-warning">unregistered account</span>}
            </>
          )}
          <span aria-hidden>·</span>
          <span title="Original publication time">
            pub <Timestamp value={e.firstPublishedAt} seconds className="text-fg-2" />
          </span>
          <span title="Collected by this system">
            col <Timestamp value={e.origin?.collectedAt ?? e.firstSeenAt} className="text-fg-3" />
          </span>
          <Age value={e.firstPublishedAt ?? e.firstSeenAt} className="text-fg-2" />
          <span aria-hidden>·</span>
          <span className="font-mono" title="Total items vs. independent source groups">
            {e.sourceCount} src / {e.independentSourceCount} indep
          </span>
          <span className="font-mono text-fg-3">{e.ref}</span>
        </div>
        {e.assets.length > 0 ? (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {e.assets.slice(0, 6).map((a) => (
              <TickerChip key={a.symbol} symbol={a.symbol} relation={a.relation} title={`${a.name} — ${a.relation}, mapping confidence ${Math.round(a.confidence * 100)}%`} />
            ))}
          </div>
        ) : (
          <p className="mt-1.5 text-2xs text-fg-3">Affected assets: unknown</p>
        )}
        {!compact && e.whyRelevant && <p className="mt-1.5 line-clamp-1 text-2xs text-fg-3">Why it may matter: {e.whyRelevant}</p>}
      </div>

      <div className="col-span-2 mt-2 flex items-start gap-0.5 md:col-span-1 md:mt-0 md:flex-col">
        <IconButton label={e.user.saved ? "Unsave" : "Save"} active={e.user.saved} onClick={() => onToggleSaved?.(e)}>
          {e.user.saved ? <BookmarkCheck className="size-4" /> : <Bookmark className="size-4" />}
        </IconButton>
        <IconButton label={reviewed ? "Mark as not reviewed" : "Mark as reviewed"} active={reviewed} onClick={() => onToggleReviewed?.(e)}>
          <CheckCheck className="size-4" />
        </IconButton>
        {e.origin?.url ? (
          <a href={e.origin.url} target="_blank" rel="noopener noreferrer nofollow" aria-label="Open original source" title="Open original source" className="inline-flex size-7 items-center justify-center rounded-md text-fg-3 hover:bg-hover hover:text-fg">
            <ExternalLink className="size-4" />
          </a>
        ) : (
          <span className="inline-flex size-7 items-center justify-center text-fg-3/40" title={e.isDemo ? "Sample data has no original source" : "No original link available"}>
            <ExternalLink className="size-4" />
          </span>
        )}
        <Link href={`/events/${e.id}`} aria-label="Open investigation" title="Open investigation" className="inline-flex size-7 items-center justify-center rounded-md text-fg-3 hover:bg-hover hover:text-accent">
          <ScanSearch className="size-4" />
        </Link>
      </div>
    </article>
  );
});
