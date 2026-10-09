import { createTestDatabase, type Db } from "@/server/db/client";
import { seedDefaults } from "@/server/db/seed";
import type { PipelineConfig, PipelineContext } from "@/server/pipeline/process";
import { DisabledAnalysisProvider, type AnalysisProvider } from "@/server/providers/ai/types";
import { evaluateAlerts } from "@/server/alerts/engine";

/**
 * Test helpers: a real (in-memory) PostgreSQL via PGlite with the production
 * migrations applied. Integration tests exercise actual SQL, not mocks.
 */
export async function setupTestDb(options: { seed?: boolean } = {}) {
  const handle = await createTestDatabase();
  if (options.seed) await seedDefaults(handle.db);
  return handle;
}

export function testPipelineConfig(overrides: Partial<PipelineConfig> = {}): PipelineConfig {
  return {
    includeDemo: true,
    aiEnabled: false,
    maxAiAnalysesPerDay: 10,
    maxAiDailyCostUsd: 1,
    minScoreForAi: 0,
    staleAfterHours: 24,
    retentionDays: { x: 30, rss: 365 },
    maxPostsPerBatch: 100,
    alerts: { cooldownMinutes: 30, maxPerHour: 50, maxAgeHours: 6 },
    appUrl: "http://localhost:3000",
    ...overrides,
  };
}

export function testContext(db: Db, opts: { now?: () => Date; ai?: AnalysisProvider; config?: Partial<PipelineConfig>; alerts?: boolean } = {}): PipelineContext {
  return {
    db,
    now: opts.now ?? (() => new Date()),
    ai: opts.ai ?? new DisabledAnalysisProvider(),
    config: testPipelineConfig(opts.config),
    onMaterialChange: opts.alerts === false ? undefined : async (ctx, result) => void (await evaluateAlerts(ctx, result)),
  };
}
