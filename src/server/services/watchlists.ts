import { and, count, eq, inArray } from "drizzle-orm";
import type { z } from "zod";
import { getAsset } from "@/config/assets";
import type { AlertRuleDTO, WatchlistDTO } from "@/domain/dto";
import type { AlertRuleBody, WatchlistBody } from "@/server/api/schemas";
import { entitlementsFor } from "@/server/auth/entitlements";
import type { AuthUser } from "@/server/auth/session";
import type { Db } from "@/server/db/client";
import { alertRules, watchlistAssets, watchlists } from "@/server/db/schema";
import { forbidden, notFound } from "@/server/lib/errors";
import { audit } from "./audit";

type WatchlistInput = z.infer<typeof WatchlistBody>;
type AlertRuleInput = z.infer<typeof AlertRuleBody>;

/** Watchlist templates. Assets are dictionary symbols; keywords are matched on word boundaries. */
export const WATCHLIST_TEMPLATES: { id: string; name: string; input: Omit<WatchlistInput, "name"> }[] = [
  {
    id: "us-equities",
    name: "US equities (mega-cap)",
    input: { minImportance: 50, minConfidence: 0, categories: [], sourceIds: [], keywords: [], notify: true, channels: ["in_app"], assets: ["AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSLA", "SPY"].map((symbol) => ({ symbol })) },
  },
  {
    id: "semiconductors",
    name: "Semiconductors",
    input: { minImportance: 45, minConfidence: 0, categories: [], sourceIds: [], keywords: ["export controls", "foundry", "wafer"], notify: true, channels: ["in_app"], assets: ["NVDA", "AMD", "INTC", "TSM", "ASML", "AVGO", "MU", "QCOM", "AMAT", "LRCX", "SOXX"].map((symbol) => ({ symbol })) },
  },
  {
    id: "ai-infrastructure",
    name: "AI infrastructure",
    input: { minImportance: 45, minConfidence: 0, categories: [], sourceIds: [], keywords: ["data center", "hyperscaler", "AI chips"], notify: true, channels: ["in_app"], assets: ["NVDA", "AVGO", "MSFT", "GOOGL", "AMZN", "META", "ORCL", "SMCI"].map((symbol) => ({ symbol })) },
  },
  {
    id: "macro",
    name: "Macroeconomics",
    input: { minImportance: 50, minConfidence: 0, categories: ["economic_data", "monetary_policy"], sourceIds: [], keywords: ["CPI", "payrolls", "GDP", "inflation"], notify: true, channels: ["in_app"], assets: ["UST2Y", "UST10Y", "DXY", "SPX"].map((symbol) => ({ symbol })) },
  },
  {
    id: "federal-reserve",
    name: "Federal Reserve",
    input: { minImportance: 40, minConfidence: 0, categories: ["monetary_policy"], sourceIds: [], keywords: ["FOMC", "Federal Reserve", "Powell"], notify: true, channels: ["in_app"], assets: ["FEDFUNDS", "UST2Y"].map((symbol) => ({ symbol })) },
  },
  {
    id: "btc-eth",
    name: "Bitcoin & Ethereum",
    input: { minImportance: 45, minConfidence: 0, categories: ["digital_asset"], sourceIds: [], keywords: ["stablecoin", "spot bitcoin ETF"], notify: true, channels: ["in_app"], assets: ["BTC", "ETH", "COIN"].map((symbol) => ({ symbol })) },
  },
  {
    id: "commodities",
    name: "Commodities",
    input: { minImportance: 45, minConfidence: 0, categories: ["commodity"], sourceIds: [], keywords: ["OPEC"], notify: true, channels: ["in_app"], assets: ["WTI", "BRENT", "NATGAS", "GOLD", "COPPER"].map((symbol) => ({ symbol })) },
  },
];

async function toDTO(db: Db, rows: (typeof watchlists.$inferSelect)[]): Promise<WatchlistDTO[]> {
  if (rows.length === 0) return [];
  const assets = await db.select().from(watchlistAssets).where(inArray(watchlistAssets.watchlistId, rows.map((r) => r.id)));
  return rows.map((w) => ({
    id: w.id,
    name: w.name,
    description: w.description,
    minImportance: w.minImportance,
    minConfidence: w.minConfidence,
    categories: w.categories,
    sourceIds: w.sourceIds,
    keywords: w.keywords,
    notify: w.notify,
    channels: w.channels,
    assets: assets
      .filter((a) => a.watchlistId === w.id)
      .map((a) => ({ symbol: a.symbol, name: a.name, assetClass: a.assetClass, aliases: a.aliases, custom: a.custom })),
    createdAt: w.createdAt.toISOString(),
    updatedAt: w.updatedAt.toISOString(),
  }));
}

export async function listWatchlists(db: Db, userId: string): Promise<WatchlistDTO[]> {
  const rows = await db.select().from(watchlists).where(eq(watchlists.userId, userId)).orderBy(watchlists.name);
  return toDTO(db, rows);
}

async function ownedWatchlist(db: Db, userId: string, id: string) {
  const [row] = await db.select().from(watchlists).where(and(eq(watchlists.id, id), eq(watchlists.userId, userId)));
  if (!row) throw notFound("Watchlist not found");
  return row;
}

async function replaceAssets(db: Db, watchlistId: string, assets: WatchlistInput["assets"]) {
  await db.delete(watchlistAssets).where(eq(watchlistAssets.watchlistId, watchlistId));
  const unique = new Map(assets.map((a) => [a.symbol, a]));
  if (unique.size === 0) return;
  await db.insert(watchlistAssets).values(
    [...unique.values()].map((a) => {
      const def = getAsset(a.symbol);
      return {
        watchlistId,
        symbol: a.symbol,
        name: def?.name ?? a.name ?? a.symbol,
        assetClass: def?.assetClass ?? null,
        aliases: a.aliases ?? [],
        custom: !def,
      };
    }),
  );
}

export async function createWatchlist(db: Db, auth: AuthUser, input: WatchlistInput): Promise<WatchlistDTO> {
  const [{ value }] = await db.select({ value: count() }).from(watchlists).where(eq(watchlists.userId, auth.id));
  if (Number(value) >= entitlementsFor(auth.plan).maxWatchlists) throw forbidden("Watchlist limit reached for your plan");
  const { assets, ...rest } = input;
  const [row] = await db.insert(watchlists).values({ ...rest, description: rest.description ?? null, userId: auth.id }).returning();
  await replaceAssets(db, row.id, assets);
  await audit(db, { userId: auth.id, action: "watchlist.create", entityType: "watchlist", entityId: row.id });
  return (await toDTO(db, [row]))[0];
}

export async function updateWatchlist(db: Db, auth: AuthUser, id: string, input: WatchlistInput): Promise<WatchlistDTO> {
  await ownedWatchlist(db, auth.id, id);
  const { assets, ...rest } = input;
  const [row] = await db
    .update(watchlists)
    .set({ ...rest, description: rest.description ?? null, updatedAt: new Date() })
    .where(and(eq(watchlists.id, id), eq(watchlists.userId, auth.id)))
    .returning();
  await replaceAssets(db, id, assets);
  await audit(db, { userId: auth.id, action: "watchlist.update", entityType: "watchlist", entityId: id });
  return (await toDTO(db, [row]))[0];
}

export async function deleteWatchlist(db: Db, auth: AuthUser, id: string): Promise<void> {
  await ownedWatchlist(db, auth.id, id);
  await db.delete(watchlists).where(and(eq(watchlists.id, id), eq(watchlists.userId, auth.id)));
  await audit(db, { userId: auth.id, action: "watchlist.delete", entityType: "watchlist", entityId: id });
}

export async function createFromTemplate(db: Db, auth: AuthUser, templateId: string): Promise<WatchlistDTO> {
  const t = WATCHLIST_TEMPLATES.find((x) => x.id === templateId);
  if (!t) throw notFound("Template not found");
  return createWatchlist(db, auth, { name: t.name, ...t.input });
}

// --- Alert rules ---------------------------------------------------------------

function ruleDTO(r: typeof alertRules.$inferSelect): AlertRuleDTO {
  return {
    id: r.id,
    name: r.name,
    enabled: r.enabled,
    watchlistId: r.watchlistId,
    minImportance: r.minImportance,
    minConfidence: r.minConfidence,
    categories: r.categories,
    assetSymbols: r.assetSymbols,
    sourceCategories: r.sourceCategories,
    verificationStates: r.verificationStates,
    requireTimeSensitive: r.requireTimeSensitive,
    channels: r.channels,
    cooldownMinutes: r.cooldownMinutes,
    includeDemo: r.includeDemo,
  };
}

export async function listAlertRules(db: Db, userId: string): Promise<AlertRuleDTO[]> {
  const rows = await db.select().from(alertRules).where(eq(alertRules.userId, userId)).orderBy(alertRules.createdAt);
  return rows.map(ruleDTO);
}

export async function createAlertRule(db: Db, auth: AuthUser, input: AlertRuleInput): Promise<AlertRuleDTO> {
  const [{ value }] = await db.select({ value: count() }).from(alertRules).where(eq(alertRules.userId, auth.id));
  if (Number(value) >= entitlementsFor(auth.plan).maxAlertRules) throw forbidden("Alert rule limit reached for your plan");
  if (input.watchlistId) await ownedWatchlist(db, auth.id, input.watchlistId);
  const [row] = await db
    .insert(alertRules)
    .values({ ...input, watchlistId: input.watchlistId ?? null, cooldownMinutes: input.cooldownMinutes ?? null, userId: auth.id })
    .returning();
  await audit(db, { userId: auth.id, action: "alert_rule.create", entityType: "alert_rule", entityId: row.id });
  return ruleDTO(row);
}

export async function updateAlertRule(db: Db, auth: AuthUser, id: string, input: AlertRuleInput): Promise<AlertRuleDTO> {
  if (input.watchlistId) await ownedWatchlist(db, auth.id, input.watchlistId);
  const [row] = await db
    .update(alertRules)
    .set({ ...input, watchlistId: input.watchlistId ?? null, cooldownMinutes: input.cooldownMinutes ?? null, updatedAt: new Date() })
    .where(and(eq(alertRules.id, id), eq(alertRules.userId, auth.id)))
    .returning();
  if (!row) throw notFound("Alert rule not found");
  await audit(db, { userId: auth.id, action: "alert_rule.update", entityType: "alert_rule", entityId: id });
  return ruleDTO(row);
}

export async function deleteAlertRule(db: Db, auth: AuthUser, id: string): Promise<void> {
  const rows = await db.delete(alertRules).where(and(eq(alertRules.id, id), eq(alertRules.userId, auth.id))).returning({ id: alertRules.id });
  if (rows.length === 0) throw notFound("Alert rule not found");
  await audit(db, { userId: auth.id, action: "alert_rule.delete", entityType: "alert_rule", entityId: id });
}
