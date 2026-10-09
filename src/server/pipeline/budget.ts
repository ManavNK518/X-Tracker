import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@/server/db/client";
import { usageRecords } from "@/server/db/schema";
import { utcDayKey } from "@/lib/time";

/**
 * Usage accounting and budget checks. Costs are *estimates* from published
 * pricing tables, recorded per call, and summed per UTC day.
 */
export async function recordUsage(
  db: Db,
  entry: {
    provider: string;
    operation: string;
    units?: number;
    inputTokens?: number;
    outputTokens?: number;
    cacheReadTokens?: number;
    costUsd?: number;
    meta?: Record<string, unknown>;
    at?: Date;
  },
): Promise<void> {
  await db.insert(usageRecords).values({
    provider: entry.provider,
    operation: entry.operation,
    units: entry.units ?? 0,
    inputTokens: entry.inputTokens ?? 0,
    outputTokens: entry.outputTokens ?? 0,
    cacheReadTokens: entry.cacheReadTokens ?? 0,
    costUsd: (entry.costUsd ?? 0).toFixed(6),
    day: utcDayKey(entry.at ?? new Date()),
    meta: entry.meta ?? {},
  });
}

export async function usageToday(db: Db, provider: string, operation?: string, now = new Date()) {
  const conditions = [eq(usageRecords.provider, provider), eq(usageRecords.day, utcDayKey(now))];
  if (operation) conditions.push(eq(usageRecords.operation, operation));
  const [row] = await db
    .select({
      calls: sql<number>`count(*)::int`,
      units: sql<number>`coalesce(sum(${usageRecords.units}), 0)::int`,
      cost: sql<string>`coalesce(sum(${usageRecords.costUsd}), 0)::text`,
    })
    .from(usageRecords)
    .where(and(...conditions));
  return { calls: Number(row?.calls ?? 0), units: Number(row?.units ?? 0), costUsd: Number(row?.cost ?? 0) };
}

export interface AiBudgetDecision {
  allowed: boolean;
  reason: string | null;
  analysesToday: number;
  costToday: number;
}

export async function checkAiBudget(
  db: Db,
  limits: { maxAnalysesPerDay: number; maxDailyCostUsd: number; estimatedCallCostUsd: number },
  now = new Date(),
): Promise<AiBudgetDecision> {
  const today = await usageToday(db, "anthropic", "extract", now);
  if (today.calls >= limits.maxAnalysesPerDay) {
    return { allowed: false, reason: `daily AI analysis limit reached (${today.calls}/${limits.maxAnalysesPerDay})`, analysesToday: today.calls, costToday: today.costUsd };
  }
  if (today.costUsd + limits.estimatedCallCostUsd > limits.maxDailyCostUsd) {
    return {
      allowed: false,
      reason: `daily AI cost budget reached (est. $${today.costUsd.toFixed(4)} of $${limits.maxDailyCostUsd.toFixed(2)})`,
      analysesToday: today.calls,
      costToday: today.costUsd,
    };
  }
  return { allowed: true, reason: null, analysesToday: today.calls, costToday: today.costUsd };
}
