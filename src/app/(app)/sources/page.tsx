"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Pencil, Plus, Scale, Trash2 } from "lucide-react";
import { CATEGORY_LABELS, EVENT_CATEGORIES, categoryLabel } from "@/domain/categories";
import type { SourceDTO } from "@/domain/dto";
import { SOURCE_CATEGORIES, SOURCE_CATEGORY_LABELS, PROVIDER_LABELS, type ProviderId } from "@/domain/sources";
import { apiFetch, ApiClientError } from "@/lib/client/api";
import { cn } from "@/lib/client/cn";
import { useMe, useToasts } from "@/components/providers/app-providers";
import { Badge, StatusDot } from "@/components/ui/badges";
import { MultiSelect } from "@/components/ui/multi-select";
import { Button, Checkbox, Dialog, EmptyState, ErrorState, Field, Input, PageHeader, Panel, Select, SkeletonRows, Tabs, Textarea, Toggle } from "@/components/ui/primitives";
import { Timestamp } from "@/components/ui/time";

interface CollectionRule {
  id: string;
  name: string;
  query: string;
  enabled: boolean;
  maxResults: number;
  intervalSeconds: number;
  sinceId: string | null;
  lastRunAt: string | null;
  lastError: string | null;
}

const statusDot = (s: string) => (s === "ok" ? "ok" : s === "error" ? "error" : s === "rate_limited" || s === "awaiting_credentials" ? "warn" : "off") as "ok" | "error" | "warn" | "off";

type SourceDraft = {
  provider: "x" | "rss";
  externalId: string;
  handle: string;
  name: string;
  category: string;
  isPrimary: boolean;
  authorityDomains: string[];
  organization: string;
  topics: string;
  enabled: boolean;
  notes: string;
};

function SourceForm({ source, onDone }: { source: SourceDTO | null; onDone: () => void }) {
  const { push } = useToasts();
  const [d, setD] = useState<SourceDraft>(
    source
      ? {
          provider: source.provider as "x" | "rss",
          externalId: source.externalId,
          handle: source.handle ?? "",
          name: source.name,
          category: source.category,
          isPrimary: source.isPrimary,
          authorityDomains: source.authorityDomains,
          organization: source.organization ?? "",
          topics: source.topics.join(", "),
          enabled: source.enabled,
          notes: source.notes ?? "",
        }
      : { provider: "x", externalId: "", handle: "", name: "", category: "news_org", isPrimary: false, authorityDomains: [], organization: "", topics: "", enabled: false, notes: "" },
  );
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof SourceDraft>(k: K, v: SourceDraft[K]) => setD((x) => ({ ...x, [k]: v }));
  const save = useMutation({
    mutationFn: () => {
      const common = {
        name: d.name,
        category: d.category,
        isPrimary: d.isPrimary,
        authorityDomains: d.authorityDomains,
        organization: d.organization || null,
        topics: d.topics.split(",").map((t) => t.trim()).filter(Boolean),
        enabled: d.enabled,
        notes: d.notes || null,
      };
      if (source) return apiFetch(`/api/sources/${source.id}`, { method: "PATCH", body: { ...common, ...(source.provider === "x" ? { handle: d.handle } : {}) } });
      return apiFetch("/api/sources", { method: "POST", body: { ...common, provider: d.provider, externalId: d.provider === "x" ? d.handle : d.externalId, handle: d.provider === "x" ? d.handle : null } });
    },
    onSuccess: () => {
      push({ title: "Source saved" });
      onDone();
    },
    onError: (e) => setError(e instanceof ApiClientError ? e.message : "Save failed"),
  });
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      {!source && (
        <Field label="Provider">
          <Select value={d.provider} onChange={(e) => set("provider", e.target.value as "x" | "rss")}>
            <option value="x">X account (requires X API credentials; billed per post read)</option>
            <option value="rss">RSS / Atom feed (official sources)</option>
          </Select>
        </Field>
      )}
      {d.provider === "x" ? (
        <Field label="X handle" hint="Without @. Collection uses the official X API only.">
          <Input value={d.handle} onChange={(e) => set("handle", e.target.value)} required placeholder="federalreserve" className="font-mono" />
        </Field>
      ) : (
        <Field label="Feed URL" hint="Only add feeds you are permitted to access programmatically.">
          <Input value={d.externalId} onChange={(e) => set("externalId", e.target.value)} required disabled={Boolean(source)} placeholder="https://…" className="font-mono" />
        </Field>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Display name">
          <Input value={d.name} onChange={(e) => set("name", e.target.value)} required maxLength={120} />
        </Field>
        <Field label="Organisation" hint="Accounts of the same organisation are not independent of each other.">
          <Input value={d.organization} onChange={(e) => set("organization", e.target.value)} maxLength={120} />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Source category">
          <Select value={d.category} onChange={(e) => set("category", e.target.value)}>
            {SOURCE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {SOURCE_CATEGORY_LABELS[c]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Topics" hint="Comma-separated.">
          <Input value={d.topics} onChange={(e) => set("topics", e.target.value)} />
        </Field>
      </div>
      <Checkbox
        checked={d.isPrimary}
        onChange={(v) => set("isPrimary", v)}
        label="Official / primary source"
        description="The issuer itself (e.g. a central bank, regulator, or company account). Popularity or a verification badge is not a reason to tick this."
      />
      {d.isPrimary && (
        <div>
          <MultiSelect label="Authoritative for" options={EVENT_CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABELS[c] }))} value={d.authorityDomains} onChange={(v) => set("authorityDomains", v)} />
          <p className="mt-1 text-2xs text-fg-3">Categories where this source can confirm a claim (e.g. a central bank for monetary policy).</p>
        </div>
      )}
      <Checkbox checked={d.enabled} onChange={(v) => set("enabled", v)} label="Enabled" description={d.provider === "x" ? "Enabled X sources are collected on every poll and count against the daily X read budget." : undefined} />
      <Field label="Notes">
        <Textarea value={d.notes} onChange={(e) => set("notes", e.target.value)} className="min-h-14" />
      </Field>
      {error && <p className="text-xs text-negative">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" variant="primary" loading={save.isPending}>
          Save
        </Button>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function ReliabilityDialog({ source, onClose, isOwner }: { source: SourceDTO; onClose: () => void; isOwner: boolean }) {
  const qc = useQueryClient();
  const obs = useQuery({
    queryKey: ["reliability", source.id],
    queryFn: () => apiFetch<{ id: string; category: string; outcome: string; note: string; recordedBy: string; createdAt: string }[]>(`/api/sources/${source.id}/reliability`),
  });
  const [category, setCategory] = useState<string>(source.authorityDomains[0] ?? "other_material");
  const [outcome, setOutcome] = useState("confirmed");
  const [note, setNote] = useState("");
  const add = useMutation({
    mutationFn: () => apiFetch(`/api/sources/${source.id}/reliability`, { method: "POST", body: { category, outcome, note } }),
    onSuccess: () => {
      setNote("");
      void qc.invalidateQueries({ queryKey: ["reliability", source.id] });
      void qc.invalidateQueries({ queryKey: ["sources"] });
    },
  });
  return (
    <Dialog open onClose={onClose} title={`Reliability evidence · ${source.name}`} wide>
      <p className="mb-3 text-xs text-fg-3">
        Reliability is evidence-based and provisional until {5} resolved observations exist. Follower counts, engagement and verification badges are never inputs. Disputes are recorded as “unresolved” — a denial does not prove a claim false.
      </p>
      {obs.isLoading ? (
        <SkeletonRows rows={2} />
      ) : obs.data?.length ? (
        <ul className="mb-4 max-h-64 space-y-2 overflow-y-auto">
          {obs.data.map((o) => (
            <li key={o.id} className="rounded border border-line-subtle p-2 text-xs">
              <div className="flex items-center gap-2 text-2xs text-fg-3">
                <Badge tone={o.outcome === "confirmed" ? "positive" : o.outcome === "refuted" ? "negative" : o.outcome === "corrected" ? "warning" : "neutral"}>{o.outcome}</Badge>
                <span>{categoryLabel(o.category)}</span>
                <Timestamp value={o.createdAt} />
                <span>{o.recordedBy === "system" ? "automatic" : "manual"}</span>
              </div>
              <p className="mt-1 text-fg-2">{o.note}</p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mb-4 text-xs text-fg-3">No observations yet.</p>
      )}
      {isOwner && (
        <form
          className="space-y-3 border-t border-line-subtle pt-3"
          onSubmit={(e) => {
            e.preventDefault();
            add.mutate();
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Claim category">
              <Select value={category} onChange={(e) => setCategory(e.target.value)}>
                {EVENT_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_LABELS[c]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Outcome">
              <Select value={outcome} onChange={(e) => setOutcome(e.target.value)}>
                <option value="confirmed">Confirmed by later evidence</option>
                <option value="refuted">Refuted by authoritative evidence</option>
                <option value="corrected">Corrected by the source</option>
                <option value="unresolved">Unresolved</option>
              </Select>
            </Field>
          </div>
          <Field label="Evidence note" hint="Required. Link or describe the evidence behind this observation.">
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} required minLength={3} className="min-h-14" />
          </Field>
          <Button type="submit" size="sm" loading={add.isPending}>
            Record observation
          </Button>
        </form>
      )}
    </Dialog>
  );
}

function RuleDialog({ rule, onDone }: { rule: CollectionRule | null; onDone: () => void }) {
  const [name, setName] = useState(rule?.name ?? "");
  const [query, setQuery] = useState(rule?.query ?? "");
  const [enabled, setEnabled] = useState(rule?.enabled ?? false);
  const [maxResults, setMaxResults] = useState(rule?.maxResults ?? 25);
  const [intervalSeconds, setIntervalSeconds] = useState(rule?.intervalSeconds ?? 900);
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => {
      const body = { name, query, enabled, maxResults, intervalSeconds };
      return rule ? apiFetch(`/api/collection-rules/${rule.id}`, { method: "PUT", body }) : apiFetch("/api/collection-rules", { method: "POST", body });
    },
    onSuccess: onDone,
    onError: (e) => setError(e instanceof ApiClientError ? e.message : "Save failed"),
  });
  const reads = Math.round((3600 / intervalSeconds) * 24 * maxResults);
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <Field label="Name">
        <Input value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} />
      </Field>
      <Field label="X recent-search query" hint="X API v2 operators, e.g. (FOMC OR CPI) -is:retweet lang:en. Keep queries focused to control cost.">
        <Textarea value={query} onChange={(e) => setQuery(e.target.value)} required className="min-h-16 font-mono text-xs" />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Max results per run (10–100)">
          <Input type="number" min={10} max={100} value={maxResults} onChange={(e) => setMaxResults(Number(e.target.value))} className="font-mono" />
        </Field>
        <Field label="Interval (seconds)">
          <Input type="number" min={60} max={86400} value={intervalSeconds} onChange={(e) => setIntervalSeconds(Number(e.target.value))} className="font-mono" />
        </Field>
      </div>
      <p className="rounded border border-warning/30 bg-warning-soft px-3 py-2 text-2xs text-warning">
        Worst case ≈ {reads.toLocaleString()} post reads/day if every run is full, plus up to one author profile per post (≈ ${(reads * 0.015).toFixed(2)}/day at $0.005 per post and $0.010 per profile).
        Keyword rules together may use at most half of the daily X cost cap by default (X_KEYWORD_RULE_BUDGET_SHARE). Check current pricing in the X Developer Console.
      </p>
      <Checkbox checked={enabled} onChange={setEnabled} label="Enabled" />
      {error && <p className="text-xs text-negative">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" variant="primary" loading={save.isPending}>
          Save rule
        </Button>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export default function SourcesPage() {
  const me = useMe();
  const isOwner = me?.user.role === "owner";
  const qc = useQueryClient();
  const [tab, setTab] = useState<"sources" | "rules">("sources");
  const [provider, setProvider] = useState<"all" | ProviderId>("all");
  const [editing, setEditing] = useState<SourceDTO | "new" | null>(null);
  const [reliability, setReliability] = useState<SourceDTO | null>(null);
  const [editingRule, setEditingRule] = useState<CollectionRule | "new" | null>(null);
  const sources = useQuery({ queryKey: ["sources"], queryFn: () => apiFetch<SourceDTO[]>("/api/sources") });
  const rules = useQuery({ queryKey: ["collection-rules"], queryFn: () => apiFetch<CollectionRule[]>("/api/collection-rules") });
  const toggle = useMutation({
    mutationFn: (s: SourceDTO) => apiFetch(`/api/sources/${s.id}`, { method: "PATCH", body: { enabled: !s.enabled } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sources"] }),
  });
  const del = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/sources/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sources"] }),
  });
  const delRule = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/collection-rules/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["collection-rules"] }),
  });
  const visible = useMemo(() => (sources.data ?? []).filter((s) => provider === "all" || s.provider === provider), [sources.data, provider]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Sources"
        description="Who is monitored and how. Reliability is evidence-based and stays provisional until enough resolved observations exist — popularity and verification badges are not inputs."
        actions={
          isOwner && tab === "sources" ? (
            <Button size="sm" variant="accent" icon={<Plus className="size-3.5" />} onClick={() => setEditing("new")}>
              Add source
            </Button>
          ) : isOwner ? (
            <Button size="sm" variant="accent" icon={<Plus className="size-3.5" />} onClick={() => setEditingRule("new")}>
              Add query rule
            </Button>
          ) : null
        }
      />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "sources", label: "Registered sources", count: sources.data?.length },
          { id: "rules", label: "X keyword rules", count: rules.data?.length },
        ]}
      />
      {!isOwner && <p className="text-xs text-fg-3">Only the workspace owner can change sources.</p>}

      {tab === "sources" ? (
        <Panel
          bodyClassName="p-0"
          actions={
            <div className="flex gap-1 text-xs">
              {(["all", "rss", "x", "demo"] as const).map((p) => (
                <button key={p} onClick={() => setProvider(p)} className={cn("rounded px-2 py-0.5", provider === p ? "bg-accent-soft text-fg" : "text-fg-3 hover:text-fg")}>
                  {p === "all" ? "All" : PROVIDER_LABELS[p]}
                </button>
              ))}
            </div>
          }
          title="Sources"
        >
          {sources.isLoading ? (
            <SkeletonRows rows={6} />
          ) : sources.error ? (
            <div className="p-4">
              <ErrorState error={sources.error} onRetry={() => sources.refetch()} />
            </div>
          ) : visible.length === 0 ? (
            <EmptyState title="No sources" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] text-xs" data-testid="sources-table">
                <thead className="border-b border-line text-left text-2xs uppercase tracking-wider text-fg-3">
                  <tr>
                    <th className="px-3 py-2 font-medium">Enabled</th>
                    <th className="px-3 py-2 font-medium">Source</th>
                    <th className="px-3 py-2 font-medium">Category</th>
                    <th className="px-3 py-2 font-medium">Primary for</th>
                    <th className="px-3 py-2 font-medium">Reliability</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 font-medium">Last success</th>
                    <th className="px-3 py-2 text-right font-medium">Items</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-line-subtle">
                  {visible.map((s) => (
                    <tr key={s.id} className="align-top">
                      <td className="px-3 py-2.5">
                        <Toggle checked={s.enabled} onChange={() => toggle.mutate(s)} label={`Enable ${s.name}`} disabled={!isOwner || s.isDemo} />
                      </td>
                      <td className="max-w-xs px-3 py-2.5">
                        <p className="text-fg">
                          {s.name} {s.isDemo && <Badge tone="warning">sample</Badge>}
                        </p>
                        <p className="mt-0.5 truncate font-mono text-2xs text-fg-3" title={s.externalId}>
                          {PROVIDER_LABELS[s.provider as ProviderId] ?? s.provider} · {s.handle ? `@${s.handle}` : s.externalId}
                        </p>
                        {s.requires && s.status === "awaiting_credentials" && <p className="mt-0.5 text-2xs text-warning">Requires {s.requires}</p>}
                      </td>
                      <td className="px-3 py-2.5 text-fg-2">{SOURCE_CATEGORY_LABELS[s.category as keyof typeof SOURCE_CATEGORY_LABELS] ?? s.category}</td>
                      <td className="px-3 py-2.5 text-fg-2">{s.isPrimary ? s.authorityDomains.map((c) => categoryLabel(c)).join(", ") || "primary" : <span className="text-fg-3">—</span>}</td>
                      <td className="px-3 py-2.5">
                        <button className="text-left hover:text-fg" onClick={() => setReliability(s)}>
                          {s.reliability.provisional ? (
                            <span className="text-fg-3">Provisional ({s.reliability.observations} obs.)</span>
                          ) : (
                            <span className="font-mono text-fg-2">
                              {Math.round((s.reliability.confirmed / Math.max(1, s.reliability.observations)) * 100)}% confirmed · n={s.reliability.observations}
                            </span>
                          )}
                        </button>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="flex items-center gap-1.5">
                          <StatusDot status={statusDot(s.status)} /> <span className="text-fg-2">{s.status.replace(/_/g, " ")}</span>
                        </span>
                        {s.lastError && s.status !== "ok" && (
                          <p className="mt-0.5 line-clamp-2 max-w-56 text-2xs text-negative" title={s.lastError}>
                            {s.lastError}
                          </p>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-fg-3">
                        <Timestamp value={s.lastSuccessAt} />
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-fg-2">{s.itemCount}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right">
                        <button className="mr-2 text-fg-3 hover:text-fg" aria-label="Reliability evidence" onClick={() => setReliability(s)}>
                          <Scale className="size-3.5" />
                        </button>
                        {isOwner && !s.isDemo && (
                          <>
                            <button className="mr-2 text-fg-3 hover:text-fg" aria-label="Edit source" onClick={() => setEditing(s)}>
                              <Pencil className="size-3.5" />
                            </button>
                            <button className="text-fg-3 hover:text-negative" aria-label="Delete source" onClick={() => confirm(`Delete ${s.name}? Collected items are kept.`) && del.mutate(s.id)}>
                              <Trash2 className="size-3.5" />
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      ) : (
        <Panel title="X keyword collection rules" subtitle="Focused recent-search queries. Every result is a billed post read; rules are off until enabled." bodyClassName="p-0">
          {rules.isLoading ? (
            <SkeletonRows rows={2} />
          ) : !rules.data?.length ? (
            <EmptyState title="No query rules" />
          ) : (
            <ul className="divide-y divide-line-subtle">
              {rules.data.map((r) => (
                <li key={r.id} className="flex flex-wrap items-start gap-3 px-4 py-3">
                  <Badge tone={r.enabled ? "positive" : "neutral"}>{r.enabled ? "enabled" : "disabled"}</Badge>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-fg">{r.name}</p>
                    <p className="mt-0.5 break-all font-mono text-2xs text-fg-3">{r.query}</p>
                    <p className="mt-0.5 text-2xs text-fg-3">
                      max {r.maxResults} · every {Math.round(r.intervalSeconds / 60)} min · last run <Timestamp value={r.lastRunAt} />
                      {r.lastError && <span className="ml-1 text-negative">· {r.lastError}</span>}
                    </p>
                  </div>
                  {isOwner && (
                    <div className="flex gap-1">
                      <Button size="xs" variant="ghost" onClick={() => setEditingRule(r)}>
                        Edit
                      </Button>
                      <Button size="xs" variant="ghost" onClick={() => confirm("Delete this rule?") && delRule.mutate(r.id)}>
                        Delete
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      )}

      <Dialog open={editing !== null} onClose={() => setEditing(null)} title={editing === "new" ? "Add source" : "Edit source"} wide>
        {editing !== null && (
          <SourceForm
            source={editing === "new" ? null : editing}
            onDone={() => {
              setEditing(null);
              void qc.invalidateQueries({ queryKey: ["sources"] });
            }}
          />
        )}
      </Dialog>
      <Dialog open={editingRule !== null} onClose={() => setEditingRule(null)} title={editingRule === "new" ? "Add query rule" : "Edit query rule"} wide>
        {editingRule !== null && (
          <RuleDialog
            rule={editingRule === "new" ? null : editingRule}
            onDone={() => {
              setEditingRule(null);
              void qc.invalidateQueries({ queryKey: ["collection-rules"] });
            }}
          />
        )}
      </Dialog>
      {reliability && <ReliabilityDialog source={reliability} isOwner={isOwner} onClose={() => setReliability(null)} />}
    </div>
  );
}
