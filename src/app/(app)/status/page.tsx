"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Play, Search } from "lucide-react";
import type { ConnectionStateDTO } from "@/domain/dto";
import { apiFetch, ApiClientError } from "@/lib/client/api";
import { useMe, useToasts } from "@/components/providers/app-providers";
import { Badge, StatusDot } from "@/components/ui/badges";
import { Button, ErrorState, Input, PageHeader, Panel, Skeleton } from "@/components/ui/primitives";
import { Timestamp } from "@/components/ui/time";

interface StatusDTO {
  generatedAt: string;
  connection: ConnectionStateDTO;
  database: { kind: string; ok: boolean };
  integrations: Record<string, string | boolean>;
  providers: { provider: string; status: string; lastSuccessAt: string | null; lastErrorAt: string | null; lastError: string | null; consecutiveFailures: number; rateLimitRemaining: number | null; rateLimitResetAt: string | null; details: Record<string, unknown> }[];
  workers: { workerId: string; mode: string; startedAt: string; lastBeatAt: string; alive: boolean }[];
  queue: { pending: number; processing: number; failed: number; total: number; maxDepth: number };
  funnel24h: { collected: number; outcomes: Record<string, number>; alertDecisions: Record<string, number> };
  runs: { id: string; job: string; status: string; startedAt: string; durationMs: number | null; stats: Record<string, unknown>; error: string | null }[];
  failedJobs: { id: string; job: string; refId: string | null; error: string; attempts: number; createdAt: string }[];
  ai: { configured: boolean; model: string | null; lastSuccessfulAnalysisAt: string | null; today: { calls: number; units: number; costUsd: number }; limits: { maxAnalysesPerDay: number; maxDailyCostUsd: number; minScoreForAi: number }; paused: string | null; failures24h: Record<string, number> };
  x: { configured: boolean; mode: string; postReadsToday: number; userReadsToday: number; estimatedCostToday: number; dailyReadBudget: number; maxQueriesPerHour: number };
  notifications: { channels: { channel: string; configured: boolean; state: string; verifiedAt: string | null; lastError: string | null }[]; last24h: { channel: string; status: string; n: number }[]; recentFailures: { id: string; channel: string; attempts: number; lastError: string | null; updatedAt: string }[] };
  marketData: { status: string; note: string };
}

interface Metrics {
  windowDays: number;
  labelledEvents: number;
  precision: { value: number | null; n: number; note: string };
  falsePositiveRate: { value: number | null; n: number; note: string };
  duplicateRate: { value: number | null; n: number; note: string };
  lateRate: { value: number | null; n: number; note: string };
  recall: { value: number | null; n: number; note: string };
  detectionLatencySeconds: { p50: number | null; p90: number | null; n: number; note: string };
  coverage: { events: number; publishedTimestamp: number | null; assets: number | null; originalUrl: number | null };
  corroborationRate: number | null;
  calibration: { bucket: string; labelled: number; incorrectRate: number | null; note: string }[];
}

const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);
const OUTCOME_LABELS: Record<string, string> = {
  new_event: "New events",
  attached: "Attached to existing events",
  duplicate: "Exact duplicates",
  filtered_spam: "Filtered: spam/promotion",
  filtered_low_info: "Filtered: low information",
  filtered_irrelevant: "Filtered: not market-relevant",
  content_unavailable: "Content unavailable",
};

function Trace() {
  const [q, setQ] = useState("");
  const t = useMutation({ mutationFn: (query: string) => apiFetch<{ diagnosis: string[]; event: Record<string, unknown> | null; item: Record<string, unknown> | null }>(`/api/status/trace?q=${encodeURIComponent(query)}`) });
  return (
    <Panel title="Why didn't I get an alert?" subtitle="Trace an event (EV- ID or UUID) or a post/feed item (item UUID or provider ID) through the pipeline.">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (q.trim()) t.mutate(q.trim());
        }}
      >
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="EV-XXXXXXX, item UUID, or X post ID" className="font-mono text-xs" aria-label="Trace identifier" />
        <Button type="submit" icon={<Search className="size-3.5" />} loading={t.isPending}>
          Trace
        </Button>
      </form>
      {t.error && <p className="mt-2 text-xs text-negative">{(t.error as Error).message}</p>}
      {t.data && (
        <ol className="mt-3 space-y-1.5 text-sm" data-testid="trace-result">
          {t.data.diagnosis.map((d, i) => (
            <li key={i} className="flex gap-2 text-fg-2">
              <span className="font-mono text-2xs text-fg-3">{i + 1}.</span>
              {d}
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}

export default function StatusPage() {
  const me = useMe();
  const qc = useQueryClient();
  const { push } = useToasts();
  const status = useQuery({ queryKey: ["status"], queryFn: () => apiFetch<StatusDTO>("/api/status"), refetchInterval: 15_000 });
  const metrics = useQuery({ queryKey: ["metrics"], queryFn: () => apiFetch<Metrics>("/api/status/metrics?days=30") });
  const jobs = useQuery({ queryKey: ["jobs"], queryFn: () => apiFetch<{ workerMode: string; inProcess: boolean; jobs: string[] }>("/api/admin/jobs") });
  const run = useMutation({
    mutationFn: (job: string) => apiFetch<{ result: { status: string; error?: string } | null }>("/api/admin/jobs", { method: "POST", body: { job } }),
    onSuccess: (r, job) => {
      push({ title: `${job}: ${r.result?.status ?? "started"}`, body: r.result?.error, tone: r.result?.status === "error" ? "error" : "default" });
      void qc.invalidateQueries({ queryKey: ["status"] });
    },
    onError: (e) => push({ title: "Could not run job", body: e instanceof ApiClientError ? e.message : String(e), tone: "error" }),
  });

  if (status.isLoading) return <Skeleton className="h-96" />;
  if (status.error || !status.data) return <ErrorState error={status.error} onRetry={() => status.refetch()} />;
  const s = status.data;
  const isOwner = me?.user.role === "owner";
  const outcomes = Object.entries(s.funnel24h.outcomes).sort((a, b) => b[1] - a[1]);
  const decisions = Object.entries(s.funnel24h.alertDecisions).sort((a, b) => b[1] - a[1]);

  return (
    <div className="space-y-4" data-testid="status-page">
      <PageHeader
        title="System Status"
        description="Collection, analysis and delivery health. A missing alert can be attributed to no new posts, a collection failure, a filter rule, an AI failure, a threshold, a verification requirement or a delivery failure."
        actions={
          <span className="text-2xs text-fg-3">
            Updated <Timestamp value={s.generatedAt} seconds />
          </span>
        }
      />

      <div className="grid gap-3 md:grid-cols-4">
        <Panel title="Data mode">
          <p className="text-lg font-semibold uppercase tracking-wide" data-testid="status-mode">
            {s.connection.mode.replace(/_/g, " ").replace("+", " + ")}
          </p>
          <p className="mt-1 text-2xs text-fg-3">{s.connection.demoMode ? "Demo mode on — sample items are labelled." : "Demo mode off."}</p>
        </Panel>
        <Panel title="Worker">
          <p className="flex items-center gap-2 text-sm">
            <StatusDot status={s.connection.workerAlive ? "ok" : "error"} pulse={s.connection.workerAlive} />
            {s.connection.workerAlive ? "Running" : "Not running"}
          </p>
          <p className="mt-1 text-2xs text-fg-3">
            Last heartbeat <Timestamp value={s.connection.workerLastBeatAt} seconds /> · {s.workers[0]?.mode ?? "—"}
          </p>
        </Panel>
        <Panel title="Database">
          <p className="flex items-center gap-2 text-sm">
            <StatusDot status={s.database.ok ? "ok" : "error"} /> {s.database.kind === "pglite" ? "Embedded PostgreSQL (PGlite)" : "PostgreSQL"}
          </p>
        </Panel>
        <Panel title="Queue">
          <p className="font-mono text-lg">
            {s.queue.pending}
            <span className="text-xs text-fg-3"> pending</span>
          </p>
          <p className="mt-1 text-2xs text-fg-3">
            {s.queue.processing} processing · {s.queue.failed} failed · backpressure at {s.queue.maxDepth}
          </p>
        </Panel>
      </div>

      <Panel title="Providers" bodyClassName="p-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-xs">
            <thead className="border-b border-line text-left text-2xs uppercase tracking-wider text-fg-3">
              <tr>
                <th className="px-3 py-2 font-medium">Provider</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Last success</th>
                <th className="px-3 py-2 font-medium">Last error</th>
                <th className="px-3 py-2 font-medium">Rate limit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-subtle">
              {s.providers.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-4 text-center text-fg-3">
                    No provider has run yet.
                  </td>
                </tr>
              )}
              {s.providers.map((p) => (
                <tr key={p.provider} className="align-top">
                  <td className="px-3 py-2 font-mono text-fg">{p.provider}</td>
                  <td className="px-3 py-2">
                    <span className="flex items-center gap-1.5">
                      <StatusDot status={p.status === "ok" ? "ok" : p.status === "error" ? "error" : p.status === "degraded" ? "warn" : "off"} />
                      {p.status.replace(/_/g, " ")}
                      {p.consecutiveFailures > 0 && <span className="text-2xs text-negative">({p.consecutiveFailures} consecutive failures)</span>}
                    </span>
                    {typeof p.details.reason === "string" && <p className="mt-0.5 text-2xs text-fg-3">{p.details.reason}</p>}
                  </td>
                  <td className="px-3 py-2 text-fg-2">
                    <Timestamp value={p.lastSuccessAt} seconds />
                  </td>
                  <td className="max-w-sm px-3 py-2 text-fg-3">
                    {p.lastError ? (
                      <>
                        <Timestamp value={p.lastErrorAt} /> <span className="text-negative">{p.lastError}</span>
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-3 py-2 font-mono text-fg-3">
                    {p.rateLimitRemaining !== null ? `${p.rateLimitRemaining} left` : "—"}
                    {p.rateLimitResetAt && (
                      <>
                        {" "}
                        · resets <Timestamp value={p.rateLimitResetAt} />
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Pipeline funnel (last 24h)" subtitle="Where collected items went, and what happened to your alerts">
          <dl className="space-y-1.5 text-xs">
            <div className="flex justify-between border-b border-line-subtle pb-1.5">
              <dt className="text-fg">Items collected</dt>
              <dd className="font-mono">{s.funnel24h.collected}</dd>
            </div>
            {outcomes.map(([k, v]) => (
              <div key={k} className="flex justify-between">
                <dt className="text-fg-2">{OUTCOME_LABELS[k] ?? k}</dt>
                <dd className="font-mono text-fg-2">{v}</dd>
              </div>
            ))}
            {outcomes.length === 0 && <p className="text-fg-3">No items processed in the last 24 hours.</p>}
            <div className="mt-2 border-t border-line-subtle pt-2">
              <p className="mb-1 text-2xs uppercase tracking-wider text-fg-3">Your alert decisions</p>
              {decisions.map(([k, v]) => (
                <div key={k} className="flex justify-between">
                  <dt className="text-fg-2">{k.replace(/_/g, " ")}</dt>
                  <dd className="font-mono text-fg-2">{v}</dd>
                </div>
              ))}
              {decisions.length === 0 && <p className="text-fg-3">No alert evaluations in the last 24 hours.</p>}
            </div>
          </dl>
        </Panel>
        <Trace />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="AI analysis" subtitle={s.ai.configured ? `Model ${s.ai.model}` : "Not configured — rules-based analysis only"}>
          <dl className="space-y-1 text-xs">
            <div className="flex justify-between">
              <dt className="text-fg-2">Analyses today</dt>
              <dd className="font-mono">
                {s.ai.today.calls} / {s.ai.limits.maxAnalysesPerDay}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-fg-2">Estimated cost today</dt>
              <dd className="font-mono">
                ${s.ai.today.costUsd.toFixed(4)} / ${s.ai.limits.maxDailyCostUsd.toFixed(2)}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-fg-2">Min. importance for AI</dt>
              <dd className="font-mono">{s.ai.limits.minScoreForAi}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-fg-2">Last successful analysis</dt>
              <dd>
                <Timestamp value={s.ai.lastSuccessfulAnalysisAt} />
              </dd>
            </div>
            {s.ai.paused && <p className="mt-2 rounded bg-warning-soft px-2 py-1 text-warning">AI paused: {s.ai.paused}. Processing continues rules-only.</p>}
            {Object.entries(s.ai.failures24h).map(([k, v]) => (
              <p key={k} className="text-2xs text-negative">
                {k.replace(/_/g, " ")}: {v}
              </p>
            ))}
          </dl>
        </Panel>
        <Panel title="X API usage" subtitle={s.x.configured ? `Mode: ${s.x.mode}` : "Not configured (X_BEARER_TOKEN missing)"}>
          <dl className="space-y-1 text-xs">
            <div className="flex justify-between">
              <dt className="text-fg-2">Post reads today</dt>
              <dd className="font-mono">
                {s.x.postReadsToday} / {s.x.dailyReadBudget}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-fg-2">User reads today</dt>
              <dd className="font-mono">{s.x.userReadsToday}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-fg-2">Estimated cost today</dt>
              <dd className="font-mono">${s.x.estimatedCostToday.toFixed(3)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-fg-2">Max queries / hour</dt>
              <dd className="font-mono">{s.x.maxQueriesPerHour}</dd>
            </div>
          </dl>
          <p className="mt-2 text-2xs text-fg-3">Estimates use configured per-read prices; the X Developer Console is authoritative.</p>
        </Panel>
        <Panel title="Notification channels">
          <ul className="space-y-1.5 text-xs">
            {s.notifications.channels.map((c) => (
              <li key={c.channel} className="flex items-center justify-between gap-2">
                <span className="capitalize text-fg-2">{c.channel}</span>
                <Badge tone={c.state === "verified" ? "positive" : c.state === "failing" ? "negative" : c.state === "configured_unverified" ? "warning" : "neutral"}>
                  {c.state.replace(/_/g, " ")}
                </Badge>
              </li>
            ))}
          </ul>
          {s.notifications.recentFailures.length > 0 && (
            <div className="mt-3 border-t border-line-subtle pt-2">
              <p className="mb-1 text-2xs uppercase tracking-wider text-fg-3">Recent delivery failures</p>
              {s.notifications.recentFailures.map((f) => (
                <p key={f.id} className="text-2xs text-negative">
                  {f.channel} · {f.attempts} attempts · {f.lastError}
                </p>
              ))}
            </div>
          )}
          <p className="mt-2 text-2xs text-fg-3">In-app delivery is always on. External channels are “verified” only after a successful test from Settings.</p>
        </Panel>
      </div>

      <Panel title="Evaluation metrics (30 days)" subtitle="Based on stored events and your feedback labels. Metrics without enough labelled data are shown as insufficient rather than estimated.">
        {metrics.data ? (
          <div className="grid gap-4 text-xs md:grid-cols-3">
            <dl className="space-y-1">
              {(
                [
                  ["Alert precision", metrics.data.precision],
                  ["False-positive rate", metrics.data.falsePositiveRate],
                  ["Duplicate-alert rate", metrics.data.duplicateRate],
                  ["Late-alert rate", metrics.data.lateRate],
                  ["Recall", metrics.data.recall],
                ] as const
              ).map(([label, m]) => (
                <div key={label} className="flex justify-between gap-2" title={m.note}>
                  <dt className="text-fg-2">{label}</dt>
                  <dd className="text-right font-mono">{m.value === null ? <span className="text-fg-3">{m.note.startsWith("insufficient") ? `n=${m.n} (insufficient)` : "n/a"}</span> : pct(m.value)}</dd>
                </div>
              ))}
            </dl>
            <dl className="space-y-1">
              <div className="flex justify-between">
                <dt className="text-fg-2">Detection latency p50 / p90</dt>
                <dd className="font-mono">
                  {metrics.data.detectionLatencySeconds.p50 === null ? "—" : `${Math.round(metrics.data.detectionLatencySeconds.p50)}s`} / {metrics.data.detectionLatencySeconds.p90 === null ? "—" : `${Math.round(metrics.data.detectionLatencySeconds.p90)}s`}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-fg-2">Corroboration rate</dt>
                <dd className="font-mono">{pct(metrics.data.corroborationRate)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-fg-2">Field coverage: timestamp / assets / URL</dt>
                <dd className="font-mono">
                  {pct(metrics.data.coverage.publishedTimestamp)} / {pct(metrics.data.coverage.assets)} / {pct(metrics.data.coverage.originalUrl)}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-fg-2">Labelled events</dt>
                <dd className="font-mono">{metrics.data.labelledEvents}</dd>
              </div>
            </dl>
            <div>
              <p className="mb-1 text-2xs uppercase tracking-wider text-fg-3">Confidence calibration</p>
              {metrics.data.calibration.length === 0 ? (
                <p className="text-fg-3">No labelled events yet.</p>
              ) : (
                metrics.data.calibration.map((c) => (
                  <p key={c.bucket} className="flex justify-between text-fg-2">
                    <span>{c.bucket}</span>
                    <span className="font-mono">{c.incorrectRate === null ? `n=${c.labelled}` : `${pct(c.incorrectRate)} incorrect`}</span>
                  </p>
                ))
              )}
            </div>
          </div>
        ) : (
          <Skeleton className="h-24" />
        )}
      </Panel>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Panel title="Recent job runs" bodyClassName="p-0">
          <div className="max-h-96 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 border-b border-line bg-surface text-left text-2xs uppercase tracking-wider text-fg-3">
                <tr>
                  <th className="px-3 py-2 font-medium">Started</th>
                  <th className="px-3 py-2 font-medium">Job</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 text-right font-medium">ms</th>
                  <th className="px-3 py-2 font-medium">Detail</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-subtle">
                {s.runs.map((r) => (
                  <tr key={r.id} className="align-top">
                    <td className="whitespace-nowrap px-3 py-1.5">
                      <Timestamp value={r.startedAt} seconds className="text-fg-3" />
                    </td>
                    <td className="px-3 py-1.5 font-mono text-fg-2">{r.job}</td>
                    <td className="px-3 py-1.5">
                      <Badge tone={r.status === "ok" ? "positive" : r.status === "error" ? "negative" : r.status === "running" ? "info" : "neutral"}>{r.status}</Badge>
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono text-fg-3">{r.durationMs ?? "—"}</td>
                    <td className="max-w-md px-3 py-1.5 text-2xs text-fg-3">
                      {r.error ? <span className="text-negative">{r.error}</span> : Object.entries(r.stats ?? {}).filter(([, v]) => typeof v !== "object").slice(0, 5).map(([k, v]) => `${k}=${String(v)}`).join(" · ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
        <div className="space-y-4">
          <Panel title="Dead-letter queue" subtitle="Work that failed after bounded retries">
            {s.failedJobs.length === 0 ? (
              <p className="text-xs text-fg-3">No failed jobs.</p>
            ) : (
              <ul className="space-y-1.5 text-2xs">
                {s.failedJobs.map((f) => (
                  <li key={f.id}>
                    <span className="font-mono text-fg-2">{f.job}</span> · <Timestamp value={f.createdAt} /> · {f.attempts} attempts
                    <p className="text-negative">{f.error}</p>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          {isOwner && (
            <Panel title="Run a job now" subtitle={jobs.data?.inProcess ? "Inline worker" : "Only available with the inline worker"}>
              <div className="flex flex-wrap gap-1.5">
                {(jobs.data?.jobs ?? []).map((j) => (
                  <Button key={j} size="xs" icon={<Play className="size-3" />} loading={run.isPending && run.variables === j} onClick={() => run.mutate(j)}>
                    {j}
                  </Button>
                ))}
              </div>
            </Panel>
          )}
          <Panel title="Market data">
            <p className="text-xs text-fg-2">Not connected.</p>
            <p className="mt-1 text-2xs text-fg-3">{s.marketData.note}</p>
          </Panel>
        </div>
      </div>
    </div>
  );
}
