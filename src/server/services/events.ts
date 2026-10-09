import { and, arrayOverlaps, asc, desc, eq, gte, inArray, lte, or, sql, type SQL } from "drizzle-orm";
import type { EventDetailDTO, FeedEventDTO, FeedPageDTO, ScoreComponentDTO } from "@/domain/dto";
import type { FeedQueryInput } from "@/server/api/schemas";
import type { Db } from "@/server/db/client";
import {
  alertDecisions,
  contradictions,
  eventAssets,
  eventClassifications,
  eventItems,
  events,
  feedback,
  itemAnalyses,
  itemContents,
  items,
  researchNotes,
  scoreRecords,
  sources,
  userEventStates,
  verificationAttempts,
} from "@/server/db/schema";
import { badRequest, notFound } from "@/server/lib/errors";
import { excerpt } from "@/server/lib/text";
import { safeHttpUrl } from "@/server/lib/url";

const tsExpr = sql<Date>`coalesce(${events.firstPublishedAt}, ${events.firstSeenAt})`;

interface Cursor {
  ts?: string;
  imp?: number;
  act?: string;
  id: string;
}

function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify(c)).toString("base64url");
}

function decodeCursor(raw: string | undefined): Cursor | null {
  if (!raw) return null;
  try {
    const c = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Cursor;
    if (typeof c.id !== "string" || !/^[0-9a-f-]{36}$/.test(c.id)) throw new Error("bad id");
    return c;
  } catch {
    throw badRequest("Invalid cursor");
  }
}

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (m) => `\\${m}`);
}

export async function listEvents(db: Db, userId: string, q: FeedQueryInput, defaults: { includeDemo: boolean }): Promise<FeedPageDTO> {
  const conditions: SQL[] = [];
  const includeDemo = q.includeDemo ?? defaults.includeDemo;
  if (!includeDemo) conditions.push(eq(events.isDemo, false));
  if (q.categories.length) conditions.push(arrayOverlaps(events.categories, q.categories));
  if (q.verification.length) conditions.push(inArray(events.verificationStatus, q.verification));
  if (q.minImportance !== undefined) conditions.push(gte(events.importance, q.minImportance));
  if (q.minConfidence !== undefined) conditions.push(gte(events.confidence, q.minConfidence));
  if (q.from) conditions.push(gte(tsExpr, new Date(q.from)));
  if (q.to) conditions.push(lte(tsExpr, new Date(q.to)));
  if (q.assets.length) {
    const symbols = q.assets.map((s) => s.toUpperCase());
    conditions.push(sql`exists (select 1 from ${eventAssets} ea where ea.event_id = ${events.id} and ea.symbol in (${sql.join(symbols.map((s) => sql`${s}`), sql`, `)}))`);
  }
  if (q.sources.length) {
    conditions.push(
      sql`exists (select 1 from ${eventItems} ei join ${items} it on it.id = ei.item_id where ei.event_id = ${events.id} and it.source_id in (${sql.join(q.sources.map((s) => sql`${s}::uuid`), sql`, `)}))`,
    );
  }
  if (q.q) {
    const like = `%${escapeLike(q.q)}%`;
    conditions.push(
      or(
        sql`${events.title} ilike ${like}`,
        sql`${events.summary} ilike ${like}`,
        sql`${events.ref} ilike ${like}`,
        sql`exists (select 1 from ${eventAssets} ea where ea.event_id = ${events.id} and ea.symbol = ${q.q.toUpperCase().replace(/^\$/, "")})`,
      )!,
    );
  }
  if (q.hideReviewed) {
    conditions.push(sql`not exists (select 1 from ${userEventStates} us where us.event_id = ${events.id} and us.user_id = ${userId} and us.reviewed_at is not null)`);
  }
  if (q.savedOnly) {
    conditions.push(sql`exists (select 1 from ${userEventStates} us where us.event_id = ${events.id} and us.user_id = ${userId} and us.saved = true)`);
  }

  const cursor = decodeCursor(q.cursor);
  let order: SQL[];
  if (q.sort === "importance") {
    order = [desc(events.importance), desc(tsExpr), desc(events.id)];
    if (cursor && cursor.imp !== undefined && cursor.ts) {
      const cts = new Date(cursor.ts);
      conditions.push(
        sql`(${events.importance} < ${cursor.imp} or (${events.importance} = ${cursor.imp} and (${tsExpr} < ${cts} or (${tsExpr} = ${cts} and ${events.id} < ${cursor.id}))))`,
      );
    }
  } else if (q.sort === "updated") {
    order = [desc(events.lastActivityAt), desc(events.id)];
    if (cursor?.act) {
      const ca = new Date(cursor.act);
      conditions.push(sql`(${events.lastActivityAt} < ${ca} or (${events.lastActivityAt} = ${ca} and ${events.id} < ${cursor.id}))`);
    }
  } else {
    order = [desc(tsExpr), desc(events.id)];
    if (cursor?.ts) {
      const cts = new Date(cursor.ts);
      conditions.push(sql`(${tsExpr} < ${cts} or (${tsExpr} = ${cts} and ${events.id} < ${cursor.id}))`);
    }
  }

  const rows = await db
    .select()
    .from(events)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(...order)
    .limit(q.limit + 1);
  const page = rows.slice(0, q.limit);
  const hydrated = await hydrateEvents(db, userId, page);
  const last = page[page.length - 1];
  const nextCursor =
    rows.length > q.limit && last
      ? encodeCursor({
          id: last.id,
          ts: (last.firstPublishedAt ?? last.firstSeenAt).toISOString(),
          imp: last.importance,
          act: last.lastActivityAt.toISOString(),
        })
      : null;
  return { items: hydrated, nextCursor };
}

type EventRow = typeof events.$inferSelect;

export async function hydrateEvents(db: Db, userId: string, rows: EventRow[]): Promise<FeedEventDTO[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const originIds = rows.map((r) => r.originItemId).filter((x): x is string => Boolean(x));
  const origins = originIds.length
    ? await db
        .select({ item: items, content: itemContents, source: sources, analysis: { flags: itemAnalyses.filterFlags } })
        .from(items)
        .leftJoin(itemContents, eq(itemContents.itemId, items.id))
        .leftJoin(sources, eq(sources.id, items.sourceId))
        .leftJoin(itemAnalyses, eq(itemAnalyses.itemId, items.id))
        .where(inArray(items.id, originIds))
    : [];
  const originMap = new Map(origins.map((o) => [o.item.id, o]));
  const assetRows = await db
    .select({ eventId: eventAssets.eventId, symbol: eventAssets.symbol, name: eventAssets.name, relation: eventAssets.relation, confidence: eventAssets.confidence })
    .from(eventAssets)
    .where(inArray(eventAssets.eventId, ids))
    .orderBy(desc(eventAssets.confidence));
  const states = await db
    .select()
    .from(userEventStates)
    .where(and(eq(userEventStates.userId, userId), inArray(userEventStates.eventId, ids)));
  const stateMap = new Map(states.map((s) => [s.eventId, s]));

  return rows.map((e) => {
    const o = e.originItemId ? originMap.get(e.originItemId) : undefined;
    const explanation = (e.explanation ?? {}) as { whyScore?: string[]; whyDetected?: string[] };
    const analysis = (e.analysis ?? {}) as { transmission?: string[] };
    const st = stateMap.get(e.id);
    return {
      id: e.id,
      ref: e.ref,
      title: e.title,
      summary: e.summary,
      primaryCategory: e.primaryCategory,
      categories: e.categories,
      lifecycle: e.lifecycle,
      verificationStatus: e.verificationStatus,
      importance: e.importance,
      importanceCoverage: e.importanceCoverage,
      confidence: e.confidence,
      confidenceCoverage: e.confidenceCoverage,
      band: e.band,
      firstSeenAt: e.firstSeenAt.toISOString(),
      firstPublishedAt: e.firstPublishedAt?.toISOString() ?? null,
      lastActivityAt: e.lastActivityAt.toISOString(),
      sourceCount: e.sourceCount,
      independentSourceCount: e.independentSourceCount,
      isDemo: e.isDemo,
      aiStatus: e.aiStatus,
      whyRelevant: analysis.transmission?.[0] ?? explanation.whyDetected?.[0] ?? null,
      flags: o?.analysis?.flags ?? [],
      origin: o
        ? {
            provider: o.item.provider,
            sourceName: o.source?.name ?? o.item.authorName ?? o.item.authorHandle ?? "Unknown account",
            handle: o.item.authorHandle,
            sourceCategory: o.source?.category ?? "unknown",
            registered: Boolean(o.source),
            url: safeHttpUrl(o.item.url),
            publishedAt: o.item.publishedAt?.toISOString() ?? null,
            collectedAt: o.item.collectedAt.toISOString(),
            excerpt: o.content ? excerpt(o.content.text, 360) : null,
            contentStatus: o.item.contentStatus,
          }
        : null,
      assets: assetRows
        .filter((a) => a.eventId === e.id)
        .slice(0, 8)
        .map((a) => ({ symbol: a.symbol, name: a.name, relation: a.relation, confidence: a.confidence })),
      user: { saved: st?.saved ?? false, reviewedAt: st?.reviewedAt?.toISOString() ?? null },
    };
  });
}

export async function findEventId(db: Db, idOrRef: string): Promise<string | null> {
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrRef);
  const [row] = await db
    .select({ id: events.id })
    .from(events)
    .where(isUuid ? eq(events.id, idOrRef) : eq(events.ref, idOrRef.toUpperCase()))
    .limit(1);
  return row?.id ?? null;
}

export async function getEventDetail(db: Db, userId: string, idOrRef: string): Promise<EventDetailDTO> {
  const id = await findEventId(db, idOrRef);
  if (!id) throw notFound("Event not found");
  const [row] = await db.select().from(events).where(eq(events.id, id));
  if (!row) throw notFound("Event not found");
  const [base] = await hydrateEvents(db, userId, [row]);

  const linked = await db
    .select({ link: eventItems, item: items, content: itemContents, source: sources, analysis: itemAnalyses })
    .from(eventItems)
    .innerJoin(items, eq(items.id, eventItems.itemId))
    .leftJoin(itemContents, eq(itemContents.itemId, items.id))
    .leftJoin(sources, eq(sources.id, items.sourceId))
    .leftJoin(itemAnalyses, eq(itemAnalyses.itemId, items.id))
    .where(eq(eventItems.eventId, id))
    .orderBy(asc(items.publishedAt), asc(eventItems.addedAt));

  const [assetDetails, classifications, history, attempts, contra, fb, notes, decisions] = await Promise.all([
    db.select().from(eventAssets).where(eq(eventAssets.eventId, id)).orderBy(desc(eventAssets.confidence)),
    db.select().from(eventClassifications).where(eq(eventClassifications.eventId, id)).orderBy(desc(eventClassifications.score)),
    db.select().from(scoreRecords).where(eq(scoreRecords.eventId, id)).orderBy(desc(scoreRecords.createdAt)).limit(50),
    db.select().from(verificationAttempts).where(eq(verificationAttempts.eventId, id)).orderBy(desc(verificationAttempts.attemptedAt)).limit(20),
    db.select().from(contradictions).where(eq(contradictions.eventId, id)).orderBy(desc(contradictions.createdAt)),
    db.select({ label: feedback.label }).from(feedback).where(and(eq(feedback.eventId, id), eq(feedback.userId, userId))),
    db
      .select({ id: researchNotes.id, title: researchNotes.title, status: researchNotes.status, updatedAt: researchNotes.updatedAt })
      .from(researchNotes)
      .where(and(eq(researchNotes.eventId, id), eq(researchNotes.userId, userId))),
    db
      .select()
      .from(alertDecisions)
      .where(and(eq(alertDecisions.eventId, id), eq(alertDecisions.userId, userId)))
      .orderBy(desc(alertDecisions.createdAt))
      .limit(10),
  ]);

  return {
    ...base,
    eventTime: row.eventTime?.toISOString() ?? null,
    materialVersion: row.materialVersion,
    lastVerifiedAt: row.lastVerifiedAt?.toISOString() ?? null,
    importanceComponents: row.importanceComponents as ScoreComponentDTO[],
    confidenceComponents: row.confidenceComponents as ScoreComponentDTO[],
    explanation: row.explanation as EventDetailDTO["explanation"],
    analysis: row.analysis as EventDetailDTO["analysis"],
    items: linked.map(({ link, item, content, source, analysis }) => ({
      itemId: item.id,
      role: link.role,
      independenceKey: link.independenceKey,
      similarity: link.similarity,
      note: link.note,
      addedAt: link.addedAt.toISOString(),
      provider: item.provider,
      url: safeHttpUrl(item.url),
      authorHandle: item.authorHandle,
      authorName: item.authorName,
      publishedAt: item.publishedAt?.toISOString() ?? null,
      collectedAt: item.collectedAt.toISOString(),
      text: content?.text ?? null,
      title: content?.title ?? null,
      contentStatus: item.contentStatus,
      isDemo: item.isDemo,
      source: source ? { id: source.id, name: source.name, category: source.category, isPrimary: source.isPrimary, organization: source.organization } : null,
      analysis: analysis ? { outcome: analysis.outcome, flags: analysis.filterFlags, aiStatus: analysis.aiStatus } : null,
    })),
    assetDetails: assetDetails.map((a) => ({
      symbol: a.symbol,
      name: a.name,
      assetClass: a.assetClass,
      relation: a.relation,
      confidence: a.confidence,
      rationale: a.rationale,
      matchedText: a.matchedText,
      method: a.method,
    })),
    classifications: classifications.map((c) => ({ category: c.category, score: c.score, method: c.method, evidence: c.evidence })),
    scoreHistory: history.map((h) => ({
      id: h.id,
      importance: h.importance,
      confidence: h.confidence,
      importanceCoverage: h.importanceCoverage,
      confidenceCoverage: h.confidenceCoverage,
      verificationStatus: h.verificationStatus,
      band: h.band,
      reason: h.reason,
      scoringVersion: h.scoringVersion,
      createdAt: h.createdAt.toISOString(),
    })),
    verificationAttempts: attempts.map((a) => ({
      id: a.id,
      attemptedAt: a.attemptedAt.toISOString(),
      method: a.method,
      status: a.status,
      resultStatus: a.resultStatus,
      details: a.details as Record<string, unknown>,
      error: a.error,
    })),
    contradictions: contra.map((c) => ({ id: c.id, itemId: c.itemId, description: c.description, resolved: c.resolved, createdAt: c.createdAt.toISOString() })),
    feedback: fb.map((f) => f.label),
    notes: notes.map((n) => ({ ...n, updatedAt: n.updatedAt.toISOString() })),
    alertDecisions: decisions.map((d) => ({ decision: d.decision, reasons: d.reasons, materialVersion: d.materialVersion, createdAt: d.createdAt.toISOString() })),
  };
}

export async function setEventState(db: Db, userId: string, eventId: string, patch: { saved?: boolean; reviewed?: boolean }) {
  const id = await findEventId(db, eventId);
  if (!id) throw notFound("Event not found");
  const now = new Date();
  const values = {
    userId,
    eventId: id,
    saved: patch.saved ?? false,
    reviewedAt: patch.reviewed ? now : null,
    updatedAt: now,
  };
  const set: Record<string, unknown> = { updatedAt: now };
  if (patch.saved !== undefined) set.saved = patch.saved;
  if (patch.reviewed !== undefined) set.reviewedAt = patch.reviewed ? now : null;
  const [row] = await db
    .insert(userEventStates)
    .values(values)
    .onConflictDoUpdate({ target: [userEventStates.userId, userEventStates.eventId], set })
    .returning();
  return { saved: row.saved, reviewedAt: row.reviewedAt?.toISOString() ?? null };
}

export async function setFeedback(db: Db, userId: string, eventId: string, input: { label: string; comment?: string; remove?: boolean }) {
  const id = await findEventId(db, eventId);
  if (!id) throw notFound("Event not found");
  if (input.remove) {
    await db.delete(feedback).where(and(eq(feedback.userId, userId), eq(feedback.eventId, id), eq(feedback.label, input.label)));
  } else {
    await db
      .insert(feedback)
      .values({ userId, eventId: id, label: input.label, comment: input.comment ?? null })
      .onConflictDoUpdate({ target: [feedback.userId, feedback.eventId, feedback.label], set: { comment: input.comment ?? null } });
  }
  const rows = await db.select({ label: feedback.label }).from(feedback).where(and(eq(feedback.userId, userId), eq(feedback.eventId, id)));
  return rows.map((r) => r.label);
}
