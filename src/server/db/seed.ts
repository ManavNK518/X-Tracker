import { count } from "drizzle-orm";
import { DEFAULT_COLLECTION_RULES, DEFAULT_SOURCES } from "@/config/default-sources";
import type { Db } from "./client";
import { collectionRules, sources } from "./schema";

/**
 * Idempotent seeding of the default source registry and collection rules.
 * Existing rows are never overwritten, so user edits survive restarts.
 */
export async function seedDefaults(db: Db): Promise<{ sourcesInserted: number; rulesInserted: number }> {
  const sourceRows = DEFAULT_SOURCES.map((s) => ({
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
    config: { ...(s.config ?? {}), ...(s.requires ? { requires: s.requires } : {}) },
    notes: s.notes ?? null,
  }));
  const inserted = await db
    .insert(sources)
    .values(sourceRows)
    .onConflictDoNothing({ target: [sources.provider, sources.externalId] })
    .returning({ id: sources.id });

  let rulesInserted = 0;
  const [{ value: ruleCount }] = await db.select({ value: count() }).from(collectionRules);
  if (Number(ruleCount) === 0) {
    const rows = await db.insert(collectionRules).values(DEFAULT_COLLECTION_RULES).returning({ id: collectionRules.id });
    rulesInserted = rows.length;
  }
  return { sourcesInserted: inserted.length, rulesInserted };
}
