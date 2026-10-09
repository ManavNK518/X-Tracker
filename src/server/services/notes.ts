import { and, count, desc, eq, ilike, or } from "drizzle-orm";
import type { z } from "zod";
import type { NoteDTO } from "@/domain/dto";
import type { NoteBody } from "@/server/api/schemas";
import { entitlementsFor } from "@/server/auth/entitlements";
import type { AuthUser } from "@/server/auth/session";
import type { Db } from "@/server/db/client";
import { eventAssets, eventItems, events, items, researchNotes, sources } from "@/server/db/schema";
import { forbidden, notFound } from "@/server/lib/errors";
import { safeHttpUrl } from "@/server/lib/url";
import { findEventId } from "./events";

type NoteInput = z.infer<typeof NoteBody>;

function toDTO(n: typeof researchNotes.$inferSelect, eventRef: string | null): NoteDTO {
  return {
    id: n.id,
    eventId: n.eventId,
    eventRef,
    title: n.title,
    summary: n.summary,
    sources: n.sources,
    thesis: n.thesis,
    assets: n.assets,
    transmission: n.transmission,
    bullish: n.bullish,
    bearish: n.bearish,
    alternatives: n.alternatives,
    risks: n.risks,
    evidenceNeeded: n.evidenceNeeded,
    invalidation: n.invalidation,
    followUpDate: n.followUpDate,
    status: n.status,
    createdAt: n.createdAt.toISOString(),
    updatedAt: n.updatedAt.toISOString(),
  };
}

export async function listNotes(db: Db, userId: string, opts: { status?: string; q?: string }): Promise<NoteDTO[]> {
  const conds = [eq(researchNotes.userId, userId)];
  if (opts.status) conds.push(eq(researchNotes.status, opts.status));
  if (opts.q) {
    const like = `%${opts.q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    conds.push(or(ilike(researchNotes.title, like), ilike(researchNotes.thesis, like), ilike(researchNotes.summary, like))!);
  }
  const rows = await db
    .select({ note: researchNotes, ref: events.ref })
    .from(researchNotes)
    .leftJoin(events, eq(events.id, researchNotes.eventId))
    .where(and(...conds))
    .orderBy(desc(researchNotes.updatedAt))
    .limit(500);
  return rows.map((r) => toDTO(r.note, r.ref));
}

export async function getNote(db: Db, userId: string, id: string): Promise<NoteDTO> {
  const [row] = await db
    .select({ note: researchNotes, ref: events.ref })
    .from(researchNotes)
    .leftJoin(events, eq(events.id, researchNotes.eventId))
    .where(and(eq(researchNotes.id, id), eq(researchNotes.userId, userId)));
  if (!row) throw notFound("Note not found");
  return toDTO(row.note, row.ref);
}

/** Pre-fills a note from an event using only stored data (original source links, never generated ones). */
export async function draftFromEvent(db: Db, userId: string, eventIdOrRef: string): Promise<Omit<NoteDTO, "id" | "createdAt" | "updatedAt">> {
  const id = await findEventId(db, eventIdOrRef);
  if (!id) throw notFound("Event not found");
  const [ev] = await db.select().from(events).where(eq(events.id, id));
  const linked = await db
    .select({ itemId: items.id, url: items.url, authorName: items.authorName, authorHandle: items.authorHandle, sourceName: sources.name, role: eventItems.role })
    .from(eventItems)
    .innerJoin(items, eq(items.id, eventItems.itemId))
    .leftJoin(sources, eq(sources.id, items.sourceId))
    .where(eq(eventItems.eventId, id));
  const assets = await db.select({ symbol: eventAssets.symbol, relation: eventAssets.relation }).from(eventAssets).where(eq(eventAssets.eventId, id));
  const analysis = (ev.analysis ?? {}) as { transmission?: string[]; evidenceToSeek?: string[]; importanceReducers?: string[] };
  void userId;
  return {
    eventId: id,
    eventRef: ev.ref,
    title: ev.title.slice(0, 200),
    summary: ev.summary,
    sources: linked
      .filter((l) => l.role !== "repeat" && l.role !== "commentary")
      .slice(0, 20)
      .map((l) => ({
        label: `${l.sourceName ?? l.authorName ?? l.authorHandle ?? "Source"} (${l.role.replace(/_/g, " ")})`,
        url: safeHttpUrl(l.url),
        itemId: l.itemId,
      })),
    thesis: "",
    assets: assets.filter((a) => a.relation === "direct").map((a) => a.symbol).slice(0, 20),
    transmission: (analysis.transmission ?? []).join("\n"),
    bullish: "",
    bearish: "",
    alternatives: "",
    risks: (analysis.importanceReducers ?? []).map((r) => `- ${r}`).join("\n"),
    evidenceNeeded: (analysis.evidenceToSeek ?? []).map((r) => `- ${r}`).join("\n"),
    invalidation: "",
    followUpDate: null,
    status: "open",
  };
}

export async function createNote(db: Db, auth: AuthUser, input: NoteInput): Promise<NoteDTO> {
  const [{ value }] = await db.select({ value: count() }).from(researchNotes).where(eq(researchNotes.userId, auth.id));
  if (Number(value) >= entitlementsFor(auth.plan).maxNotes) throw forbidden("Note limit reached for your plan");
  const eventId = input.eventId ? await findEventId(db, input.eventId) : null;
  if (input.eventId && !eventId) throw notFound("Linked event not found");
  const [row] = await db
    .insert(researchNotes)
    .values({ ...input, eventId, followUpDate: input.followUpDate ?? null, userId: auth.id })
    .returning();
  return getNote(db, auth.id, row.id);
}

export async function updateNote(db: Db, auth: AuthUser, id: string, input: NoteInput): Promise<NoteDTO> {
  const eventId = input.eventId ? await findEventId(db, input.eventId) : null;
  const rows = await db
    .update(researchNotes)
    .set({ ...input, eventId, followUpDate: input.followUpDate ?? null, updatedAt: new Date() })
    .where(and(eq(researchNotes.id, id), eq(researchNotes.userId, auth.id)))
    .returning({ id: researchNotes.id });
  if (rows.length === 0) throw notFound("Note not found");
  return getNote(db, auth.id, id);
}

export async function deleteNote(db: Db, auth: AuthUser, id: string): Promise<void> {
  const rows = await db
    .delete(researchNotes)
    .where(and(eq(researchNotes.id, id), eq(researchNotes.userId, auth.id)))
    .returning({ id: researchNotes.id });
  if (rows.length === 0) throw notFound("Note not found");
}
