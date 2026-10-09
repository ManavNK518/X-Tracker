"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Info, Plus, Trash2, X } from "lucide-react";
import { CATEGORY_LABELS, EVENT_CATEGORIES } from "@/domain/categories";
import type { SourceDTO, WatchlistDTO } from "@/domain/dto";
import { CHANNEL_LABELS, NOTIFICATION_CHANNELS } from "@/domain/misc";
import { apiFetch, ApiClientError } from "@/lib/client/api";
import { cn } from "@/lib/client/cn";
import { useToasts } from "@/components/providers/app-providers";
import { MultiSelect } from "@/components/ui/multi-select";
import { Button, Checkbox, Dialog, EmptyState, ErrorState, Field, Input, PageHeader, Panel, SkeletonRows, Textarea, Toggle } from "@/components/ui/primitives";

type Draft = Omit<WatchlistDTO, "id" | "createdAt" | "updatedAt" | "assets"> & { assets: { symbol: string; name?: string; aliases?: string[]; custom?: boolean }[] };

const emptyDraft = (): Draft => ({
  name: "",
  description: "",
  minImportance: 40,
  minConfidence: 0,
  categories: [],
  sourceIds: [],
  keywords: [],
  notify: true,
  channels: ["in_app"],
  assets: [],
});

interface AssetHit {
  symbol: string;
  name: string;
  assetClass: string;
  ambiguousTicker: boolean;
  demo: boolean;
}

function AssetPicker({ assets, onChange }: { assets: Draft["assets"]; onChange: (a: Draft["assets"]) => void }) {
  const [term, setTerm] = useState("");
  const search = useQuery({
    queryKey: ["asset-search", term],
    queryFn: () => apiFetch<AssetHit[]>(`/api/assets/search?q=${encodeURIComponent(term)}`),
    enabled: term.length >= 1,
    staleTime: 60_000,
  });
  const add = (symbol: string, name?: string, custom?: boolean) => {
    const sym = symbol.trim().toUpperCase().replace(/^\$/, "");
    if (!sym || !/^[A-Z0-9.\-]{1,20}$/.test(sym) || assets.some((a) => a.symbol === sym)) return;
    onChange([...assets, { symbol: sym, name, custom }]);
    setTerm("");
  };
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {assets.map((a) => (
          <span key={a.symbol} className={cn("inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-xs", a.custom ? "border-dashed border-warning/50 text-warning" : "border-line bg-elevated")}>
            {a.symbol}
            {a.custom && <span className="font-sans text-2xs">custom</span>}
            <button type="button" aria-label={`Remove ${a.symbol}`} onClick={() => onChange(assets.filter((x) => x.symbol !== a.symbol))} className="text-fg-3 hover:text-fg">
              <X className="size-3" />
            </button>
          </span>
        ))}
        {assets.length === 0 && <span className="text-xs text-fg-3">No assets yet.</span>}
      </div>
      <div className="relative">
        <Input
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              const exact = search.data?.find((h) => h.symbol === term.trim().toUpperCase());
              if (exact) add(exact.symbol, exact.name);
              else if (term.trim()) add(term, undefined, true);
            }
          }}
          placeholder="Search ticker or company (Enter adds a custom symbol)"
          aria-label="Add asset"
        />
        {term && (search.data?.length ?? 0) > 0 && (
          <ul className="absolute left-0 right-0 top-9 z-30 max-h-60 overflow-y-auto rounded-md border border-line bg-elevated py-1 shadow-xl">
            {search.data!.map((h) => (
              <li key={h.symbol}>
                <button type="button" onClick={() => add(h.symbol, h.name)} className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-xs hover:bg-hover">
                  <span>
                    <span className="font-mono font-medium">{h.symbol}</span> <span className="text-fg-2">{h.name}</span>
                    {h.demo && <span className="ml-1 text-2xs text-warning">sample</span>}
                  </span>
                  <span className="text-2xs text-fg-3">{h.ambiguousTicker ? "ambiguous ticker" : h.assetClass}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="flex items-start gap-1.5 text-2xs text-fg-3">
        <Info className="mt-px size-3 shrink-0" />
        Tickers that are also ordinary words (e.g. ON, F, T, MS) only match as cashtags ($F) or with the company name. Custom symbols are not in the alias dictionary; they match only their cashtag or the aliases you add.
      </p>
    </div>
  );
}

function Editor({ initial, sources, onSaved, onDeleted }: { initial: WatchlistDTO | null; sources: SourceDTO[]; onSaved: (w: WatchlistDTO) => void; onDeleted: () => void }) {
  const { push } = useToasts();
  const [draft, setDraft] = useState<Draft>(() =>
    initial ? { ...initial, description: initial.description ?? "", assets: initial.assets.map((a) => ({ symbol: a.symbol, name: a.name, aliases: a.aliases, custom: a.custom })) } : emptyDraft(),
  );
  const [keywordText, setKeywordText] = useState((initial?.keywords ?? []).join(", "));
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => {
      const body = {
        ...draft,
        keywords: keywordText.split(",").map((k) => k.trim()).filter((k) => k.length >= 2),
        assets: draft.assets.map((a) => ({ symbol: a.symbol, name: a.name, aliases: a.aliases ?? [] })),
      };
      return initial ? apiFetch<WatchlistDTO>(`/api/watchlists/${initial.id}`, { method: "PUT", body }) : apiFetch<WatchlistDTO>("/api/watchlists", { method: "POST", body });
    },
    onSuccess: (w) => {
      setError(null);
      push({ title: "Watchlist saved", body: w.name });
      onSaved(w);
    },
    onError: (e) => setError(e instanceof ApiClientError ? `${e.message}${Array.isArray(e.details) ? ` (${(e.details as { path: string; message: string }[]).map((d) => `${d.path}: ${d.message}`).join("; ")})` : ""}` : "Save failed"),
  });
  const del = useMutation({
    mutationFn: () => apiFetch(`/api/watchlists/${initial!.id}`, { method: "DELETE" }),
    onSuccess: () => onDeleted(),
  });
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
      data-testid="watchlist-editor"
    >
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Name">
          <Input value={draft.name} onChange={(e) => set("name", e.target.value)} required maxLength={80} placeholder="e.g. Semiconductors" />
        </Field>
        <Field label="Description">
          <Input value={draft.description ?? ""} onChange={(e) => set("description", e.target.value)} maxLength={500} />
        </Field>
      </div>
      <Field label="Assets">
        <AssetPicker assets={draft.assets} onChange={(a) => set("assets", a)} />
      </Field>
      <Field label="Keywords" hint="Comma-separated. Matched on word boundaries in event text. A keyword match does not imply a company benefits or suffers.">
        <Textarea value={keywordText} onChange={(e) => setKeywordText(e.target.value)} className="min-h-14" placeholder="export controls, HBM, foundry" />
      </Field>
      <div className="flex flex-wrap gap-2">
        <MultiSelect label="Categories" options={EVENT_CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABELS[c] }))} value={draft.categories} onChange={(v) => set("categories", v)} />
        <MultiSelect label="Source accounts" searchable options={sources.map((s) => ({ value: s.id, label: s.name, hint: s.provider.toUpperCase() }))} value={draft.sourceIds} onChange={(v) => set("sourceIds", v)} />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label={`Minimum alert importance: ${draft.minImportance}`} hint="Alerts only for events at or above this research-priority score.">
          <input type="range" min={0} max={100} step={5} value={draft.minImportance} onChange={(e) => set("minImportance", Number(e.target.value))} className="accent-[var(--accent)]" aria-label="Minimum alert importance" />
        </Field>
        <Field label={`Minimum evidence confidence: ${draft.minConfidence}`}>
          <input type="range" min={0} max={100} step={5} value={draft.minConfidence} onChange={(e) => set("minConfidence", Number(e.target.value))} className="accent-[var(--accent)]" aria-label="Minimum evidence confidence" />
        </Field>
      </div>
      <div className="space-y-2 rounded-md border border-line-subtle p-3">
        <div className="flex items-center justify-between">
          <span className="text-sm">Send alerts for this watchlist</span>
          <Toggle checked={draft.notify} onChange={(v) => set("notify", v)} label="Notify" />
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {NOTIFICATION_CHANNELS.map((c) => (
            <Checkbox
              key={c}
              label={CHANNEL_LABELS[c]}
              checked={draft.channels.includes(c)}
              disabled={c === "in_app" || !draft.notify}
              onChange={(v) => set("channels", v ? [...new Set([...draft.channels, c])] : draft.channels.filter((x) => x !== c))}
            />
          ))}
        </div>
        <p className="text-2xs text-fg-3">External channels deliver only when configured on the server and enabled in Settings → Notifications. Sample data is never sent externally.</p>
      </div>
      {error && (
        <p role="alert" className="text-xs text-negative">
          {error}
        </p>
      )}
      <div className="flex items-center gap-2">
        <Button type="submit" variant="primary" loading={save.isPending}>
          Save watchlist
        </Button>
        {initial && (
          <Button type="button" variant="danger" icon={<Trash2 className="size-3.5" />} loading={del.isPending} onClick={() => confirm(`Delete watchlist “${initial.name}”?`) && del.mutate()}>
            Delete
          </Button>
        )}
        {initial && initial.assets.length > 0 && (
          <Link href={`/feed?assets=${initial.assets.map((a) => a.symbol).join(",")}`} className="ml-auto text-xs text-fg-3 hover:text-fg">
            View matching events →
          </Link>
        )}
      </div>
    </form>
  );
}

export default function WatchlistsPage() {
  const qc = useQueryClient();
  const lists = useQuery({ queryKey: ["watchlists"], queryFn: () => apiFetch<WatchlistDTO[]>("/api/watchlists") });
  const sources = useQuery({ queryKey: ["sources"], queryFn: () => apiFetch<SourceDTO[]>("/api/sources") });
  const templates = useQuery({ queryKey: ["watchlist-templates"], queryFn: () => apiFetch<{ id: string; name: string; assets: string[] }[]>("/api/watchlists/templates") });
  const [chosenId, setSelectedId] = useState<string | "new" | null>(null);
  const [templateOpen, setTemplateOpen] = useState(false);
  // Default to the first watchlist until the user picks one.
  const selectedId = chosenId ?? lists.data?.[0]?.id ?? null;
  const selected = useMemo(() => lists.data?.find((l) => l.id === selectedId) ?? null, [lists.data, selectedId]);
  const fromTemplate = useMutation({
    mutationFn: (templateId: string) => apiFetch<WatchlistDTO>("/api/watchlists/templates", { method: "POST", body: { templateId } }),
    onSuccess: async (w) => {
      setTemplateOpen(false);
      await qc.invalidateQueries({ queryKey: ["watchlists"] });
      setSelectedId(w.id);
    },
  });

  return (
    <div>
      <PageHeader
        title="Watchlists"
        description="Assets, keywords, sources and categories you track. Watchlists drive relevance scoring and alerts; an alert means an event matched, not that a price will move."
        actions={
          <>
            <Button size="sm" onClick={() => setTemplateOpen(true)}>
              From template
            </Button>
            <Button size="sm" variant="accent" icon={<Plus className="size-3.5" />} onClick={() => setSelectedId("new")} data-testid="new-watchlist">
              New watchlist
            </Button>
          </>
        }
      />
      {lists.error && <ErrorState error={lists.error} onRetry={() => lists.refetch()} />}
      <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
        <Panel title="Your watchlists" bodyClassName="p-1">
          {lists.isLoading ? (
            <SkeletonRows rows={3} />
          ) : lists.data?.length ? (
            <ul>
              {lists.data.map((w) => (
                <li key={w.id}>
                  <button
                    onClick={() => setSelectedId(w.id)}
                    className={cn("w-full rounded-md px-3 py-2 text-left hover:bg-hover", selectedId === w.id && "bg-accent-soft")}
                  >
                    <p className="text-sm text-fg">{w.name}</p>
                    <p className="mt-0.5 font-mono text-2xs text-fg-3">
                      {w.assets.length} assets · {w.keywords.length} keywords · ≥{w.minImportance}
                      {w.notify ? " · alerts on" : ""}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="No watchlists yet" description="Create one or start from a template." />
          )}
        </Panel>
        <Panel title={selectedId === "new" ? "New watchlist" : selected ? `Edit · ${selected.name}` : "Watchlist"}>
          {selectedId === "new" || selected ? (
            <Editor
              key={selectedId === "new" ? "new" : selected!.id + selected!.updatedAt}
              initial={selectedId === "new" ? null : selected}
              sources={sources.data ?? []}
              onSaved={async (w) => {
                await qc.invalidateQueries({ queryKey: ["watchlists"] });
                setSelectedId(w.id);
              }}
              onDeleted={async () => {
                setSelectedId(null);
                await qc.invalidateQueries({ queryKey: ["watchlists"] });
              }}
            />
          ) : (
            <EmptyState title="Select or create a watchlist" />
          )}
        </Panel>
      </div>
      <Dialog open={templateOpen} onClose={() => setTemplateOpen(false)} title="Create from template">
        <ul className="space-y-1">
          {(templates.data ?? []).map((t) => (
            <li key={t.id}>
              <button className="w-full rounded-md px-3 py-2 text-left hover:bg-hover" onClick={() => fromTemplate.mutate(t.id)} disabled={fromTemplate.isPending}>
                <p className="text-sm">{t.name}</p>
                <p className="font-mono text-2xs text-fg-3">{t.assets.join(" ")}</p>
              </button>
            </li>
          ))}
        </ul>
      </Dialog>
    </div>
  );
}
