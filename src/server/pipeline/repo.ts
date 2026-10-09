import { and, eq, inArray, sql } from "drizzle-orm";
import type { EventCategory } from "@/domain/categories";
import { isSourceCategory, type ProviderId, type SourceCategory } from "@/domain/sources";
import type { Db } from "@/server/db/client";
import { sourceReliabilityObservations, sources, watchlistAssets, watchlists } from "@/server/db/schema";
import type { SourceRef } from "@/server/providers/source/types";

/** Shared read helpers for the pipeline. */

export type SourceRow = typeof sources.$inferSelect;

export function toSourceRef(row: SourceRow): SourceRef {
  return {
    id: row.id,
    provider: row.provider as ProviderId,
    externalId: row.externalId,
    handle: row.handle,
    name: row.name,
    category: (isSourceCategory(row.category) ? row.category : "unknown") as SourceCategory,
    isPrimary: row.isPrimary,
    authorityDomains: row.authorityDomains as EventCategory[],
    organization: row.organization,
    enabled: row.enabled,
    isDemo: row.isDemo,
    config: row.config ?? {},
    lastAttemptAt: row.lastAttemptAt,
  };
}

export async function loadSourcesByIds(db: Db, ids: string[]): Promise<Map<string, SourceRow>> {
  if (ids.length === 0) return new Map();
  const rows = await db.select().from(sources).where(inArray(sources.id, [...new Set(ids)]));
  return new Map(rows.map((r) => [r.id, r]));
}

export async function reliabilityStats(db: Db, sourceIds: string[]): Promise<Map<string, { observations: number; confirmedRate: number }>> {
  const out = new Map<string, { observations: number; confirmedRate: number }>();
  if (sourceIds.length === 0) return out;
  const rows = await db
    .select({
      sourceId: sourceReliabilityObservations.sourceId,
      resolved: sql<number>`count(*) filter (where ${sourceReliabilityObservations.outcome} <> 'unresolved')::int`,
      confirmed: sql<number>`count(*) filter (where ${sourceReliabilityObservations.outcome} = 'confirmed')::int`,
    })
    .from(sourceReliabilityObservations)
    .where(inArray(sourceReliabilityObservations.sourceId, [...new Set(sourceIds)]))
    .groupBy(sourceReliabilityObservations.sourceId);
  for (const r of rows) {
    const resolved = Number(r.resolved);
    out.set(r.sourceId, { observations: resolved, confirmedRate: resolved > 0 ? Number(r.confirmed) / resolved : 0 });
  }
  return out;
}

/** Union of watchlist assets/categories across the workspace (for the tracked-relevance component). */
export async function trackedUniverse(db: Db): Promise<{ symbols: Set<string>; categories: Set<string>; custom: { symbol: string; name: string; aliases: string[] }[] }> {
  const assetRows = await db
    .select({ symbol: watchlistAssets.symbol, name: watchlistAssets.name, aliases: watchlistAssets.aliases, custom: watchlistAssets.custom })
    .from(watchlistAssets);
  const catRows = await db.select({ categories: watchlists.categories }).from(watchlists);
  const symbols = new Set(assetRows.map((r) => r.symbol.toUpperCase()));
  const categories = new Set(catRows.flatMap((r) => r.categories));
  const custom = assetRows.filter((r) => r.custom).map((r) => ({ symbol: r.symbol, name: r.name, aliases: r.aliases }));
  return { symbols, categories, custom };
}

export async function sourceByHandle(db: Db, provider: string, handle: string): Promise<SourceRow | null> {
  const [row] = await db
    .select()
    .from(sources)
    .where(and(eq(sources.provider, provider), sql`lower(${sources.handle}) = ${handle.toLowerCase()}`))
    .limit(1);
  return row ?? null;
}
