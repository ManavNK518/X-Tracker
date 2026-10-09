import { emptyCollectResult, type CollectContext, type CollectResult, type NormalizedItem, type SourceProvider } from "../types";
import { DEMO_FIXTURES, type DemoFixture } from "./fixtures";

export interface DemoProviderOptions {
  enabled: boolean;
  /** Seconds between scripted steps. 0 releases the whole script at once. */
  intervalSeconds: number;
  /** When the current demo run started (persisted in app_state). */
  runStartedAt: Date;
  /** Identifies the run so a restarted demo creates new items. */
  runId: string;
}

/**
 * Replays the fictional demo script through the real pipeline. Every item is
 * flagged `isDemo`, has no URL, and is labelled SAMPLE DATA in the UI.
 */
export class DemoProvider implements SourceProvider {
  readonly id = "demo" as const;

  constructor(private readonly options: DemoProviderOptions) {}

  configured() {
    return this.options.enabled ? { ok: true } : { ok: false, reason: "Demo mode is off (DEMO_MODE=false)." };
  }

  externalIdFor(fixture: DemoFixture): string {
    return `demo-${this.options.runId}-${fixture.id}`;
  }

  /** Fixtures due at `now`, ordered by release time. */
  due(now: Date): { fixture: DemoFixture; releaseAt: Date; publishedAt: Date }[] {
    const start = this.options.runStartedAt.getTime();
    const interval = this.options.intervalSeconds * 1000;
    const maxStep = Math.max(...DEMO_FIXTURES.map((f) => f.step));
    return DEMO_FIXTURES.map((fixture, index) => {
      const releaseAt = new Date(fixture.step <= 0 ? start : start + fixture.step * interval);
      // Publication times are strictly increasing in script order (index adds
      // milliseconds), so processing order is deterministic. With interval 0 the
      // scripted items are placed just before the run start.
      const scripted = interval > 0 ? releaseAt.getTime() : start - (maxStep - fixture.step + 1) * 60_000;
      const publishedAt = new Date((fixture.step <= 0 ? start - (fixture.minutesAgo ?? 0) * 60_000 : scripted) + index);
      return { fixture, releaseAt, publishedAt };
    })
      .filter((d) => d.releaseAt.getTime() <= now.getTime())
      .sort((a, b) => a.releaseAt.getTime() - b.releaseAt.getTime() || a.publishedAt.getTime() - b.publishedAt.getTime());
  }

  async collect(ctx: CollectContext): Promise<CollectResult> {
    const result = emptyCollectResult();
    if (!this.options.enabled) return result;
    const sourceByHandle = new Map(ctx.sources.map((s) => [(s.handle ?? s.externalId).toLowerCase(), s]));
    const items: NormalizedItem[] = [];
    for (const { fixture, publishedAt } of this.due(ctx.now)) {
      const source = sourceByHandle.get(fixture.handle.toLowerCase()) ?? null;
      items.push({
        provider: "demo",
        externalId: this.externalIdFor(fixture),
        sourceId: source?.id ?? null,
        authorHandle: fixture.handle,
        authorName: source?.name ?? fixture.authorName ?? fixture.handle,
        authorExternalId: null,
        url: null,
        title: null,
        text: fixture.text,
        lang: "en",
        publishedAt,
        referenced: fixture.references
          ? [{ type: fixture.references.type, id: `demo-${this.options.runId}-${fixture.references.fixtureId}` }]
          : [],
        isDemo: true,
      });
    }
    result.items = items;
    for (const s of ctx.sources) {
      result.sourceOutcomes.push({ sourceId: s.id, ok: true, itemsFound: items.filter((i) => i.sourceId === s.id).length, status: "ok" });
    }
    return result;
  }
}
