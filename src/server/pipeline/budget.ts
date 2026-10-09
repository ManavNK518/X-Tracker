import { and, eq, sql } from "drizzle-orm";
import type { Env } from "@/config/env";
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

export async function usageToday(db: Db, provider: string, operation?: string, now = new Date(), purpose?: string) {
  const conditions = [eq(usageRecords.provider, provider), eq(usageRecords.day, utcDayKey(now))];
  if (operation) conditions.push(eq(usageRecords.operation, operation));
  if (purpose) conditions.push(sql`${usageRecords.meta}->>'purpose' = ${purpose}`);
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

/** Purposes recorded in usage meta for X reads, so each part of the budget can be enforced. */
export type XReadPurpose = "accounts" | "keyword_rule" | "compliance";

export interface XDailyLimits {
  maxPostReads: number;
  maxCostUsd: number;
  /** Largest share of maxCostUsd that keyword rules may use. */
  keywordRuleShare: number;
  /** Post reads held back each day for deletion re-checks (0 when re-checks are off). */
  complianceReads: number;
  postReadCostUsd: number;
}

export function xDailyLimits(env: Env): XDailyLimits {
  return {
    maxPostReads: env.X_MAX_POST_READS_PER_DAY,
    maxCostUsd: env.X_MAX_DAILY_COST_USD,
    keywordRuleShare: env.X_KEYWORD_RULE_BUDGET_SHARE,
    complianceReads: env.X_COMPLIANCE_REFRESH_HOURS > 0 ? env.X_COMPLIANCE_MAX_READS_PER_DAY : 0,
    postReadCostUsd: env.X_POST_READ_COST_USD,
  };
}

export interface XBudget {
  postReadsToday: number;
  spentTodayUsd: number;
  complianceReadsToday: number;
  keywordRuleSpentTodayUsd: number;
  /** What collection (accounts and keyword rules) may still use today. */
  collection: { postReads: number; costUsd: number; keywordRuleCostUsd: number };
  /** What deletion re-checks may still use today. */
  compliance: { postReads: number; costUsd: number };
}

/**
 * Splits today's X allowance. Deletion re-checks get a fixed daily reserve,
 * so collection can never crowd them out and they can never eat more than
 * their share. Keyword rules may use at most `keywordRuleShare` of the cost
 * cap, so a noisy rule cannot starve registered accounts.
 */
export async function xBudgetToday(db: Db, limits: XDailyLimits, now = new Date()): Promise<XBudget> {
  const all = await usageToday(db, "x", undefined, now);
  const posts = await usageToday(db, "x", "post_read", now);
  const compliance = await usageToday(db, "x", "post_read", now, "compliance");
  const keywordRule = await usageToday(db, "x", undefined, now, "keyword_rule");
  const reserveLeft = Math.max(0, Math.min(limits.complianceReads, limits.maxPostReads) - compliance.units);
  const collectionCost = Math.max(0, limits.maxCostUsd - all.costUsd - reserveLeft * limits.postReadCostUsd);
  return {
    postReadsToday: posts.units,
    spentTodayUsd: all.costUsd,
    complianceReadsToday: compliance.units,
    keywordRuleSpentTodayUsd: keywordRule.costUsd,
    collection: {
      postReads: Math.max(0, limits.maxPostReads - posts.units - reserveLeft),
      costUsd: collectionCost,
      keywordRuleCostUsd: Math.max(0, Math.min(collectionCost, limits.maxCostUsd * limits.keywordRuleShare - keywordRule.costUsd)),
    },
    compliance: {
      postReads: Math.min(reserveLeft, Math.max(0, limits.maxPostReads - posts.units)),
      costUsd: Math.max(0, limits.maxCostUsd - all.costUsd),
    },
  };
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
