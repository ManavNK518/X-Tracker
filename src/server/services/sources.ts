import { and, desc, eq, sql } from "drizzle-orm";
import type { z } from "zod";
import { RELIABILITY_MIN_OBSERVATIONS } from "@/config/scoring";
import type { SourceDTO } from "@/domain/dto";
import type { CollectionRuleBody, ReliabilityObservationBody, SourceBody, SourcePatchBody } from "@/server/api/schemas";
import type { AuthUser } from "@/server/auth/session";
import type { Db } from "@/server/db/client";
import { collectionRules, items, sourceReliabilityObservations, sources } from "@/server/db/schema";
import { badRequest, conflict, notFound } from "@/server/lib/errors";
import { safeHttpUrl } from "@/server/lib/url";
import { audit } from "./audit";

export async function listSources(db: Db, opts: { includeDemo: boolean }): Promise<SourceDTO[]> {
  const rows = await db.select().from(sources).orderBy(sources.provider, sources.name);
  const counts = await db
    .select({ sourceId: items.sourceId, n: sql<number>`count(*)::int` })
    .from(items)
    .groupBy(items.sourceId);
  const countMap = new Map(counts.map((c) => [c.sourceId, Number(c.n)]));
  const rel = await db
    .select({
      sourceId: sourceReliabilityObservations.sourceId,
      outcome: sourceReliabilityObservations.outcome,
      n: sql<number>`count(*)::int`,
    })
    .from(sourceReliabilityObservations)
    .groupBy(sourceReliabilityObservations.sourceId, sourceReliabilityObservations.outcome);
  return rows
    .filter((s) => opts.includeDemo || !s.isDemo)
    .map((s) => {
      const r = rel.filter((x) => x.sourceId === s.id);
      const get = (o: string) => Number(r.find((x) => x.outcome === o)?.n ?? 0);
      const resolved = get("confirmed") + get("refuted") + get("corrected");
      return {
        id: s.id,
        provider: s.provider,
        externalId: s.externalId,
        handle: s.handle,
        name: s.name,
        category: s.category,
        isPrimary: s.isPrimary,
        authorityDomains: s.authorityDomains,
        organization: s.organization,
        topics: s.topics,
        enabled: s.enabled,
        isDemo: s.isDemo,
        status: s.status,
        lastAttemptAt: s.lastAttemptAt?.toISOString() ?? null,
        lastSuccessAt: s.lastSuccessAt?.toISOString() ?? null,
        lastError: s.lastError,
        consecutiveErrors: s.consecutiveErrors,
        notes: s.notes,
        requires: typeof s.config.requires === "string" ? s.config.requires : null,
        itemCount: countMap.get(s.id) ?? 0,
        reliability: {
          observations: resolved,
          confirmed: get("confirmed"),
          refuted: get("refuted"),
          corrected: get("corrected"),
          provisional: resolved < RELIABILITY_MIN_OBSERVATIONS,
        },
      };
    });
}

function normalizeExternalId(provider: "x" | "rss", externalId: string, handle?: string | null): { externalId: string; handle: string | null } {
  if (provider === "rss") {
    const url = safeHttpUrl(externalId);
    if (!url) throw badRequest("RSS sources need an absolute http(s) feed URL");
    return { externalId: url, handle: null };
  }
  const h = (handle ?? externalId).replace(/^@/, "").trim();
  if (!/^[A-Za-z0-9_]{1,15}$/.test(h)) throw badRequest("X handles are 1–15 letters, digits or underscores");
  return { externalId: h.toLowerCase(), handle: h };
}

export async function createSource(db: Db, auth: AuthUser, input: z.infer<typeof SourceBody>) {
  const ids = normalizeExternalId(input.provider, input.externalId, input.handle);
  const [existing] = await db
    .select({ id: sources.id })
    .from(sources)
    .where(and(eq(sources.provider, input.provider), eq(sources.externalId, ids.externalId)));
  if (existing) throw conflict("This source is already registered");
  const [row] = await db
    .insert(sources)
    .values({
      ...input,
      ...ids,
      organization: input.organization ?? null,
      notes: input.notes ?? null,
      config: input.provider === "x" ? { requires: "X_BEARER_TOKEN" } : {},
      createdBy: auth.id,
    })
    .returning();
  await audit(db, { userId: auth.id, action: "source.create", entityType: "source", entityId: row.id, details: { provider: row.provider, externalId: row.externalId } });
  return row;
}

export async function updateSource(db: Db, auth: AuthUser, id: string, patch: z.infer<typeof SourcePatchBody>) {
  const [current] = await db.select().from(sources).where(eq(sources.id, id));
  if (!current) throw notFound("Source not found");
  if (current.isDemo) throw badRequest("Demo sources are managed by demo mode");
  const set: Record<string, unknown> = { ...patch, updatedAt: new Date() };
  if (patch.handle !== undefined && current.provider === "x") {
    const ids = normalizeExternalId("x", patch.handle ?? current.externalId);
    set.handle = ids.handle;
    set.externalId = ids.externalId;
    set.config = { ...current.config, xUserId: undefined, sinceId: undefined };
  }
  if (patch.enabled === false) set.status = "disabled";
  if (patch.enabled === true && current.status === "disabled") set.status = "never_run";
  const [row] = await db.update(sources).set(set).where(eq(sources.id, id)).returning();
  await audit(db, { userId: auth.id, action: "source.update", entityType: "source", entityId: id, details: { fields: Object.keys(patch) } });
  return row;
}

export async function deleteSource(db: Db, auth: AuthUser, id: string) {
  const rows = await db.delete(sources).where(eq(sources.id, id)).returning({ id: sources.id, name: sources.name });
  if (rows.length === 0) throw notFound("Source not found");
  await audit(db, { userId: auth.id, action: "source.delete", entityType: "source", entityId: id, details: { name: rows[0].name } });
}

export async function addReliabilityObservation(db: Db, auth: AuthUser, sourceId: string, input: z.infer<typeof ReliabilityObservationBody>) {
  const [src] = await db.select({ id: sources.id }).from(sources).where(eq(sources.id, sourceId));
  if (!src) throw notFound("Source not found");
  const [row] = await db
    .insert(sourceReliabilityObservations)
    .values({ sourceId, category: input.category, outcome: input.outcome, note: input.note, eventId: input.eventId ?? null, recordedBy: auth.id })
    .returning();
  await audit(db, { userId: auth.id, action: "source.reliability_observation", entityType: "source", entityId: sourceId, details: { outcome: input.outcome } });
  return row;
}

export async function listReliabilityObservations(db: Db, sourceId: string) {
  return db
    .select()
    .from(sourceReliabilityObservations)
    .where(eq(sourceReliabilityObservations.sourceId, sourceId))
    .orderBy(desc(sourceReliabilityObservations.createdAt))
    .limit(100);
}

// --- Collection rules ------------------------------------------------------------

export async function listCollectionRules(db: Db) {
  return db.select().from(collectionRules).orderBy(collectionRules.name);
}

export async function createCollectionRule(db: Db, auth: AuthUser, input: z.infer<typeof CollectionRuleBody>) {
  const [row] = await db.insert(collectionRules).values({ ...input, provider: "x" }).returning();
  await audit(db, { userId: auth.id, action: "collection_rule.create", entityType: "collection_rule", entityId: row.id });
  return row;
}

export async function updateCollectionRule(db: Db, auth: AuthUser, id: string, input: z.infer<typeof CollectionRuleBody>) {
  const [current] = await db.select().from(collectionRules).where(eq(collectionRules.id, id));
  if (!current) throw notFound("Collection rule not found");
  const queryChanged = current.query !== input.query;
  const [row] = await db
    .update(collectionRules)
    .set({ ...input, ...(queryChanged ? { sinceId: null } : {}), updatedAt: new Date() })
    .where(eq(collectionRules.id, id))
    .returning();
  await audit(db, { userId: auth.id, action: "collection_rule.update", entityType: "collection_rule", entityId: id });
  return row;
}

export async function deleteCollectionRule(db: Db, auth: AuthUser, id: string) {
  const rows = await db.delete(collectionRules).where(eq(collectionRules.id, id)).returning({ id: collectionRules.id });
  if (rows.length === 0) throw notFound("Collection rule not found");
  await audit(db, { userId: auth.id, action: "collection_rule.delete", entityType: "collection_rule", entityId: id });
}
