"use client";

import Link from "next/link";
import type { FeedEventDTO } from "@/domain/dto";
import { bandTone, DemoBadge, TickerChip, VerificationBadge } from "@/components/ui/badges";
import { Age } from "@/components/ui/time";
import { cn } from "@/lib/client/cn";

/** Compact event line for dashboards. */
export function EventMini({ e }: { e: FeedEventDTO }) {
  const tone = bandTone(e.importance);
  return (
    <Link href={`/events/${e.id}`} className="group flex items-start gap-3 rounded-md px-2 py-2 hover:bg-hover">
      <span className={cn("w-7 shrink-0 pt-px text-right font-mono text-sm font-semibold tabular", tone.text)} title={`Importance ${e.importance}/100 · confidence ${e.confidence}/100`}>
        {e.importance}
      </span>
      <span className="min-w-0 flex-1">
        <span className="line-clamp-2 text-xs font-medium leading-snug text-fg group-hover:text-fg">{e.title}</span>
        <span className="mt-1 flex flex-wrap items-center gap-1.5">
          {e.isDemo && <DemoBadge />}
          <VerificationBadge status={e.verificationStatus} />
          {e.assets.slice(0, 3).map((a) => (
            <TickerChip key={a.symbol} symbol={a.symbol} relation={a.relation} />
          ))}
          <Age value={e.firstPublishedAt ?? e.firstSeenAt} className="text-2xs text-fg-3" />
        </span>
      </span>
    </Link>
  );
}
