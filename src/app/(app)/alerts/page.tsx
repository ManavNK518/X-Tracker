"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CheckCheck, Pencil, Plus, Trash2 } from "lucide-react";
import { CATEGORY_LABELS, EVENT_CATEGORIES, categoryLabel } from "@/domain/categories";
import type { AlertRuleDTO, NotificationDTO } from "@/domain/dto";
import { CHANNEL_LABELS, NOTIFICATION_CHANNELS } from "@/domain/misc";
import { SOURCE_CATEGORIES, SOURCE_CATEGORY_LABELS } from "@/domain/sources";
import { VERIFICATION_META, VERIFICATION_STATES } from "@/domain/verification";
import { apiFetch, ApiClientError } from "@/lib/client/api";
import { useToasts } from "@/components/providers/app-providers";
import { Badge, DemoBadge, VerificationBadge } from "@/components/ui/badges";
import { MultiSelect } from "@/components/ui/multi-select";
import { Button, Checkbox, Dialog, EmptyState, ErrorState, Field, Input, PageHeader, Panel, SkeletonRows, Tabs, Toggle } from "@/components/ui/primitives";
import { Timestamp } from "@/components/ui/time";

const deliveryTone = (s: string) => (s === "sent" || s === "handed_to_client" ? "positive" : s === "failed" ? "negative" : s === "pending" || s === "deferred" ? "warning" : "neutral");

function Notifications() {
  const qc = useQueryClient();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const list = useQuery({
    queryKey: ["notifications", unreadOnly],
    queryFn: () => apiFetch<NotificationDTO[]>(`/api/notifications?limit=100${unreadOnly ? "&unreadOnly=true" : ""}`),
  });
  const read = useMutation({
    mutationFn: (body: { ids?: string[]; all?: boolean }) => apiFetch("/api/notifications/read", { method: "POST", body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["notifications"] });
      void qc.invalidateQueries({ queryKey: ["me"] });
    },
  });
  return (
    <Panel
      title="Notification history"
      subtitle="Every alert with its delivery status per channel. Failed deliveries are shown, never hidden."
      actions={
        <>
          <label className="flex items-center gap-1.5 text-xs text-fg-2">
            <input type="checkbox" checked={unreadOnly} onChange={(e) => setUnreadOnly(e.target.checked)} className="size-3 accent-[var(--accent)]" />
            Unread only
          </label>
          <Button size="xs" icon={<CheckCheck className="size-3" />} onClick={() => read.mutate({ all: true })}>
            Mark all read
          </Button>
        </>
      }
      bodyClassName="p-0"
    >
      {list.isLoading ? (
        <SkeletonRows rows={4} />
      ) : list.error ? (
        <div className="p-4">
          <ErrorState error={list.error} onRetry={() => list.refetch()} />
        </div>
      ) : !list.data?.length ? (
        <EmptyState title="No alerts yet" description="Alerts are created when an event matches one of your rules or notifying watchlists, and again when it changes materially (escalation, confirmation, correction)." />
      ) : (
        <ul className="divide-y divide-line-subtle" data-testid="notification-list">
          {list.data.map((n) => {
            const p = n.payload as { importance?: number; confidence?: number; verification?: string; category?: string; summary?: string; keyUncertainty?: string; sourceName?: string; changes?: string[] };
            return (
              <li key={n.id} className={`px-4 py-3 ${n.readAt ? "" : "bg-accent-soft/40"}`}>
                <div className="flex flex-wrap items-center gap-2 text-2xs text-fg-3">
                  {n.isDemo && <DemoBadge />}
                  <Badge tone={n.kind === "escalation" ? "accent" : n.kind === "correction" ? "warning" : "neutral"} className="uppercase tracking-wider">
                    {n.kind}
                  </Badge>
                  <span>{categoryLabel(p.category ?? "")}</span>
                  <Timestamp value={n.createdAt} seconds />
                  {!n.readAt && (
                    <button className="ml-auto text-fg-3 hover:text-fg" onClick={() => read.mutate({ ids: [n.id] })}>
                      mark read
                    </button>
                  )}
                </div>
                <Link href={`/events/${n.eventId}`} className="mt-1 block text-sm font-medium text-fg hover:text-accent">
                  {n.title}
                </Link>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-fg-3">
                  <span className="font-mono">imp {p.importance ?? "?"} · conf {p.confidence ?? "?"}</span>
                  {p.verification && <VerificationBadge status={p.verification} />}
                  {p.sourceName && <span>{p.sourceName}</span>}
                  {p.changes && p.changes.length > 0 && <span>changed: {p.changes.join("; ")}</span>}
                </div>
                {p.keyUncertainty && <p className="mt-1 text-2xs text-fg-3">Uncertainty: {p.keyUncertainty}</p>}
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {n.deliveries.map((d) => (
                    <Badge key={d.channel} tone={deliveryTone(d.status)} title={d.lastError ?? undefined}>
                      {CHANNEL_LABELS[d.channel as keyof typeof CHANNEL_LABELS] ?? d.channel}: {d.status.replace(/_/g, " ")}
                      {d.attempts > 1 ? ` (${d.attempts} attempts)` : ""}
                    </Badge>
                  ))}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

type RuleDraft = Omit<AlertRuleDTO, "id">;
const blankRule = (): RuleDraft => ({
  name: "",
  enabled: true,
  watchlistId: null,
  minImportance: 60,
  minConfidence: 0,
  categories: [],
  assetSymbols: [],
  sourceCategories: [],
  verificationStates: [],
  requireTimeSensitive: false,
  channels: ["in_app"],
  cooldownMinutes: null,
  includeDemo: true,
});

function RuleForm({ rule, onDone }: { rule: AlertRuleDTO | null; onDone: () => void }) {
  const { push } = useToasts();
  const [d, setD] = useState<RuleDraft>(rule ?? blankRule());
  const [assets, setAssets] = useState((rule?.assetSymbols ?? []).join(", "));
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof RuleDraft>(k: K, v: RuleDraft[K]) => setD((x) => ({ ...x, [k]: v }));
  const save = useMutation({
    mutationFn: () => {
      const body = { ...d, assetSymbols: assets.split(/[\s,]+/).map((s) => s.trim().toUpperCase()).filter(Boolean) };
      return rule ? apiFetch(`/api/alert-rules/${rule.id}`, { method: "PUT", body }) : apiFetch("/api/alert-rules", { method: "POST", body });
    },
    onSuccess: () => {
      push({ title: "Alert rule saved" });
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
      data-testid="rule-form"
    >
      <Field label="Rule name">
        <Input value={d.name} onChange={(e) => set("name", e.target.value)} required maxLength={80} name="ruleName" />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={`Minimum importance: ${d.minImportance}`}>
          <input type="range" min={0} max={100} step={5} value={d.minImportance} onChange={(e) => set("minImportance", Number(e.target.value))} className="accent-[var(--accent)]" aria-label="Minimum importance" data-testid="rule-min-importance" />
        </Field>
        <Field label={`Minimum confidence: ${d.minConfidence}`}>
          <input type="range" min={0} max={100} step={5} value={d.minConfidence} onChange={(e) => set("minConfidence", Number(e.target.value))} className="accent-[var(--accent)]" aria-label="Minimum confidence" />
        </Field>
      </div>
      <Field label="Assets (optional)" hint="Only events mapped to one of these symbols.">
        <Input value={assets} onChange={(e) => setAssets(e.target.value)} className="font-mono" placeholder="NVDA, BTC" />
      </Field>
      <div className="flex flex-wrap gap-2">
        <MultiSelect label="Categories" options={EVENT_CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABELS[c] }))} value={d.categories} onChange={(v) => set("categories", v)} />
        <MultiSelect label="Source types" options={SOURCE_CATEGORIES.map((c) => ({ value: c, label: SOURCE_CATEGORY_LABELS[c] }))} value={d.sourceCategories} onChange={(v) => set("sourceCategories", v)} />
        <MultiSelect label="Verification states" options={VERIFICATION_STATES.map((v) => ({ value: v, label: VERIFICATION_META[v].label }))} value={d.verificationStates} onChange={(v) => set("verificationStates", v)} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Checkbox checked={d.requireTimeSensitive} onChange={(v) => set("requireTimeSensitive", v)} label="Only time-sensitive events" description="Published within roughly the last 6 hours." />
        <Checkbox checked={d.includeDemo} onChange={(v) => set("includeDemo", v)} label="Include sample (demo) events" description="Sample alerts stay in-app only." />
      </div>
      <Field label="Cooldown (minutes)" hint="Minimum gap between alerts for the same event, unless it escalates or is corrected. Empty = server default.">
        <Input type="number" min={0} max={1440} value={d.cooldownMinutes ?? ""} onChange={(e) => set("cooldownMinutes", e.target.value === "" ? null : Number(e.target.value))} className="w-32 font-mono" />
      </Field>
      <div className="space-y-1.5">
        <span className="text-xs font-medium text-fg-2">Channels</span>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {NOTIFICATION_CHANNELS.map((c) => (
            <Checkbox key={c} label={CHANNEL_LABELS[c]} checked={d.channels.includes(c)} disabled={c === "in_app"} onChange={(v) => set("channels", v ? [...new Set([...d.channels, c])] : d.channels.filter((x) => x !== c))} />
          ))}
        </div>
      </div>
      {error && <p className="text-xs text-negative">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" variant="primary" loading={save.isPending} data-testid="save-rule">
          Save rule
        </Button>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function Rules() {
  const qc = useQueryClient();
  const rules = useQuery({ queryKey: ["alert-rules"], queryFn: () => apiFetch<AlertRuleDTO[]>("/api/alert-rules") });
  const [editing, setEditing] = useState<AlertRuleDTO | "new" | null>(null);
  const toggle = useMutation({
    mutationFn: (r: AlertRuleDTO) => apiFetch(`/api/alert-rules/${r.id}`, { method: "PUT", body: { ...r, enabled: !r.enabled } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["alert-rules"] }),
  });
  const del = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/alert-rules/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["alert-rules"] }),
  });
  const done = () => {
    setEditing(null);
    void qc.invalidateQueries({ queryKey: ["alert-rules"] });
  };
  return (
    <Panel
      title="Alert rules"
      subtitle="Thresholds by importance, confidence, asset, category, source type, verification and time sensitivity. Watchlists with alerts enabled act as rules too."
      actions={
        <Button size="xs" variant="accent" icon={<Plus className="size-3" />} onClick={() => setEditing("new")} data-testid="new-rule">
          New rule
        </Button>
      }
      bodyClassName="p-0"
    >
      {rules.isLoading ? (
        <SkeletonRows rows={3} />
      ) : !rules.data?.length ? (
        <EmptyState title="No alert rules" description="Without rules or notifying watchlists you will not receive alerts." />
      ) : (
        <ul className="divide-y divide-line-subtle" data-testid="rule-list">
          {rules.data.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <Toggle checked={r.enabled} onChange={() => toggle.mutate(r)} label={`Enable ${r.name}`} />
              <div className="min-w-0 flex-1">
                <p className="text-sm text-fg">{r.name}</p>
                <p className="mt-0.5 font-mono text-2xs text-fg-3">
                  imp ≥ {r.minImportance} · conf ≥ {r.minConfidence}
                  {r.categories.length > 0 && ` · ${r.categories.length} categories`}
                  {r.assetSymbols.length > 0 && ` · ${r.assetSymbols.join(" ")}`}
                  {r.verificationStates.length > 0 && ` · ${r.verificationStates.length} states`}
                  {r.requireTimeSensitive && " · time-sensitive"} · {r.channels.join(", ")}
                </p>
              </div>
              <Button size="xs" variant="ghost" icon={<Pencil className="size-3" />} onClick={() => setEditing(r)}>
                Edit
              </Button>
              <Button size="xs" variant="ghost" icon={<Trash2 className="size-3" />} onClick={() => confirm(`Delete rule “${r.name}”?`) && del.mutate(r.id)}>
                Delete
              </Button>
            </li>
          ))}
        </ul>
      )}
      <Dialog open={editing !== null} onClose={() => setEditing(null)} title={editing === "new" ? "New alert rule" : "Edit alert rule"} wide>
        {editing !== null && <RuleForm rule={editing === "new" ? null : editing} onDone={done} />}
      </Dialog>
    </Panel>
  );
}

function AlertsView() {
  const params = useSearchParams();
  const [tab, setTab] = useState<"notifications" | "rules">(params.get("tab") === "rules" ? "rules" : "notifications");
  return (
    <div className="space-y-4">
      <PageHeader
        title="Alerts"
        description="Deduplicated per event version, with cooldowns, hourly limits and quiet hours. A material update (confirmation, escalation, correction) can produce a new alert."
      />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "notifications", label: "Notifications" },
          { id: "rules", label: "Alert rules" },
        ]}
      />
      {tab === "notifications" ? <Notifications /> : <Rules />}
    </div>
  );
}

export default function AlertsPage() {
  return (
    <Suspense fallback={<SkeletonRows rows={4} />}>
      <AlertsView />
    </Suspense>
  );
}
