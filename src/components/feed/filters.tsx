"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { ArrowDownWideNarrow, Clock3, Search, X } from "lucide-react";
import { CATEGORY_LABELS, EVENT_CATEGORIES } from "@/domain/categories";
import type { SourceDTO } from "@/domain/dto";
import { VERIFICATION_META, VERIFICATION_STATES } from "@/domain/verification";
import { apiFetch } from "@/lib/client/api";
import { cn } from "@/lib/client/cn";
import { MultiSelect } from "@/components/ui/multi-select";
import { Select } from "@/components/ui/primitives";

export interface FeedFilterState {
  q: string;
  sort: "newest" | "importance" | "updated";
  categories: string[];
  assets: string[];
  sources: string[];
  verification: string[];
  minImportance: string;
  minConfidence: string;
  hideReviewed: boolean;
  savedOnly: boolean;
  from: string;
  to: string;
}

const LIST_KEYS = ["categories", "assets", "sources", "verification"] as const;

export function useFilterState(defaults: Partial<FeedFilterState> = {}) {
  const params = useSearchParams();
  const router = useRouter();
  const state: FeedFilterState = useMemo(() => {
    const list = (k: string) => (params.get(k) ? params.get(k)!.split(",").filter(Boolean) : []);
    return {
      q: params.get("q") ?? "",
      sort: (params.get("sort") as FeedFilterState["sort"]) ?? defaults.sort ?? "newest",
      categories: list("categories"),
      assets: list("assets"),
      sources: list("sources"),
      verification: list("verification"),
      minImportance: params.get("minImportance") ?? defaults.minImportance ?? "",
      minConfidence: params.get("minConfidence") ?? "",
      hideReviewed: params.get("hideReviewed") === "true",
      savedOnly: params.get("savedOnly") === "true",
      from: params.get("from") ?? "",
      to: params.get("to") ?? "",
    };
  }, [params, defaults.sort, defaults.minImportance]);

  const update = useCallback(
    (patch: Partial<FeedFilterState>) => {
      const next = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (LIST_KEYS.includes(k as (typeof LIST_KEYS)[number])) {
          const arr = v as string[];
          if (arr.length) next.set(k, arr.join(","));
          else next.delete(k);
        } else if (typeof v === "boolean") {
          if (v) next.set(k, "true");
          else next.delete(k);
        } else if (v === "" || v === undefined) {
          next.delete(k);
        } else next.set(k, String(v));
      }
      router.replace(`?${next.toString()}`, { scroll: false });
    },
    [params, router],
  );

  const clear = useCallback(() => router.replace("?", { scroll: false }), [router]);
  const activeCount =
    state.categories.length + state.assets.length + state.sources.length + state.verification.length + (state.minImportance ? 1 : 0) + (state.minConfidence ? 1 : 0) + (state.q ? 1 : 0) + (state.hideReviewed ? 1 : 0) + (state.savedOnly ? 1 : 0) + (state.from || state.to ? 1 : 0);
  return { state, update, clear, activeCount };
}

/** Converts filter state to API query parameters. */
export function filterQuery(s: FeedFilterState, extra: Record<string, string | number | boolean | undefined> = {}) {
  return {
    q: s.q || undefined,
    sort: s.sort,
    categories: s.categories,
    assets: s.assets,
    sources: s.sources,
    verification: s.verification,
    minImportance: s.minImportance || undefined,
    minConfidence: s.minConfidence || undefined,
    hideReviewed: s.hideReviewed || undefined,
    savedOnly: s.savedOnly || undefined,
    from: s.from ? new Date(`${s.from}T00:00:00`).toISOString() : undefined,
    to: s.to ? new Date(`${s.to}T23:59:59`).toISOString() : undefined,
    ...extra,
  };
}

export function FeedFilters({
  state,
  update,
  clear,
  activeCount,
  showDateRange,
}: {
  state: FeedFilterState;
  update: (p: Partial<FeedFilterState>) => void;
  clear: () => void;
  activeCount: number;
  showDateRange?: boolean;
}) {
  const sources = useQuery({ queryKey: ["sources"], queryFn: () => apiFetch<SourceDTO[]>("/api/sources"), staleTime: 60_000 });
  // Local drafts for text inputs, re-synced when the URL value changes
  // (adjusting state during render, as recommended over effects).
  const assetsJoined = state.assets.join(", ");
  const [q, setQ] = useState(state.q);
  const [assetText, setAssetText] = useState(assetsJoined);
  const [synced, setSynced] = useState({ q: state.q, assets: assetsJoined });
  if (synced.q !== state.q || synced.assets !== assetsJoined) {
    setSynced({ q: state.q, assets: assetsJoined });
    setQ(state.q);
    setAssetText(assetsJoined);
  }

  return (
    <div className="flex flex-col gap-2" data-testid="feed-filters">
      <div className="flex flex-wrap items-center gap-2">
        <form
          className="relative min-w-48 flex-1 md:max-w-xs"
          onSubmit={(e) => {
            e.preventDefault();
            update({ q: q.trim() });
          }}
        >
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-fg-3" aria-hidden />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onBlur={() => q.trim() !== state.q && update({ q: q.trim() })}
            placeholder="Search title, text, ticker, EV- ID"
            aria-label="Search events"
            className="h-7 w-full rounded-md border border-line bg-surface pl-7 pr-2 text-xs placeholder:text-fg-3 focus:border-accent-line focus:outline-none"
          />
        </form>
        <MultiSelect label="Category" options={EVENT_CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABELS[c] }))} value={state.categories} onChange={(v) => update({ categories: v })} />
        <MultiSelect
          label="Credibility"
          options={VERIFICATION_STATES.map((v) => ({ value: v, label: VERIFICATION_META[v].label }))}
          value={state.verification}
          onChange={(v) => update({ verification: v })}
        />
        <MultiSelect
          label="Source"
          searchable
          options={(sources.data ?? []).map((s) => ({ value: s.id, label: s.name, hint: `${s.provider.toUpperCase()}${s.isDemo ? " · sample" : ""}` }))}
          value={state.sources}
          onChange={(v) => update({ sources: v })}
        />
        <form
          onSubmit={(e) => {
            e.preventDefault();
            update({ assets: assetText.split(/[\s,]+/).map((s) => s.trim().toUpperCase().replace(/^\$/, "")).filter(Boolean) });
          }}
        >
          <input
            value={assetText}
            onChange={(e) => setAssetText(e.target.value)}
            onBlur={() => update({ assets: assetText.split(/[\s,]+/).map((s) => s.trim().toUpperCase().replace(/^\$/, "")).filter(Boolean) })}
            placeholder="Assets: NVDA, BTC"
            aria-label="Filter by asset symbols"
            className={cn(
              "h-7 w-36 rounded-md border bg-surface px-2 font-mono text-xs placeholder:font-sans placeholder:text-fg-3 focus:border-accent-line focus:outline-none",
              state.assets.length ? "border-accent-line" : "border-line",
            )}
          />
        </form>
        <Select aria-label="Minimum importance" value={state.minImportance} onChange={(e) => update({ minImportance: e.target.value })} className="h-7 w-auto text-xs">
          <option value="">Importance: any</option>
          <option value="20">≥ 20</option>
          <option value="40">≥ 40 moderate</option>
          <option value="60">≥ 60 high</option>
          <option value="80">≥ 80 critical</option>
        </Select>
        <Select aria-label="Minimum confidence" value={state.minConfidence} onChange={(e) => update({ minConfidence: e.target.value })} className="h-7 w-auto text-xs">
          <option value="">Confidence: any</option>
          <option value="40">≥ 40</option>
          <option value="70">≥ 70</option>
        </Select>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
        <div className="inline-flex rounded-md border border-line p-0.5" role="group" aria-label="Sort">
          {(
            [
              { id: "newest", label: "Newest", icon: Clock3 },
              { id: "importance", label: "Importance", icon: ArrowDownWideNarrow },
            ] as const
          ).map((s) => (
            <button
              key={s.id}
              type="button"
              aria-pressed={state.sort === s.id}
              onClick={() => update({ sort: s.id })}
              className={cn("inline-flex items-center gap-1 rounded px-2 py-0.5", state.sort === s.id ? "bg-accent-soft text-fg" : "text-fg-3 hover:text-fg")}
            >
              <s.icon className="size-3" aria-hidden />
              {s.label}
            </button>
          ))}
        </div>
        {showDateRange && (
          <div className="flex items-center gap-1.5">
            <label className="text-fg-3" htmlFor="from">
              From
            </label>
            <input id="from" type="date" value={state.from} onChange={(e) => update({ from: e.target.value })} className="h-7 rounded-md border border-line bg-surface px-1.5 font-mono text-xs" />
            <label className="text-fg-3" htmlFor="to">
              to
            </label>
            <input id="to" type="date" value={state.to} onChange={(e) => update({ to: e.target.value })} className="h-7 rounded-md border border-line bg-surface px-1.5 font-mono text-xs" />
          </div>
        )}
        <label className="inline-flex items-center gap-1.5 text-fg-2">
          <input type="checkbox" checked={state.hideReviewed} onChange={(e) => update({ hideReviewed: e.target.checked })} className="size-3 accent-[var(--accent)]" />
          Hide reviewed
        </label>
        <label className="inline-flex items-center gap-1.5 text-fg-2">
          <input type="checkbox" checked={state.savedOnly} onChange={(e) => update({ savedOnly: e.target.checked })} className="size-3 accent-[var(--accent)]" />
          Saved only
        </label>
        {activeCount > 0 && (
          <button type="button" onClick={clear} className="inline-flex items-center gap-1 text-fg-3 hover:text-fg">
            <X className="size-3" /> Clear {activeCount} filter{activeCount === 1 ? "" : "s"}
          </button>
        )}
      </div>
    </div>
  );
}
