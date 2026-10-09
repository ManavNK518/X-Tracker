"use client";

import Link from "next/link";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { ExternalLink, Plus, Trash2, X } from "lucide-react";
import type { NoteDTO } from "@/domain/dto";
import { NOTE_STATUS_LABELS, NOTE_STATUSES } from "@/domain/misc";
import { apiFetch, ApiClientError } from "@/lib/client/api";
import { useToasts } from "@/components/providers/app-providers";
import { Button, Field, Input, Select, Textarea } from "@/components/ui/primitives";

export type NoteDraft = Omit<NoteDTO, "id" | "createdAt" | "updatedAt">;

const SECTIONS: { key: keyof NoteDraft; label: string; hint: string }[] = [
  { key: "summary", label: "Event summary", hint: "What happened, in your own words. Keep facts separate from interpretation." },
  { key: "thesis", label: "Thesis or hypothesis", hint: "A falsifiable statement you want to test." },
  { key: "transmission", label: "Potential transmission mechanism", hint: "How could this plausibly affect the assets?" },
  { key: "bullish", label: "Bullish interpretation", hint: "The strongest case for a positive effect." },
  { key: "bearish", label: "Bearish interpretation", hint: "The strongest case for a negative effect." },
  { key: "alternatives", label: "Alternative explanations", hint: "What else could explain the information or any price move?" },
  { key: "risks", label: "Risks", hint: "What could go wrong with acting on this hypothesis?" },
  { key: "evidenceNeeded", label: "Evidence needed", hint: "Primary sources, filings, data releases to check." },
  { key: "invalidation", label: "What would invalidate the hypothesis", hint: "Decide this before looking at the outcome." },
];

export function NoteEditor({ noteId, initial, onSaved, onDeleted }: { noteId: string | null; initial: NoteDraft; onSaved: (n: NoteDTO) => void; onDeleted?: () => void }) {
  const { push } = useToasts();
  const [draft, setDraft] = useState<NoteDraft>(initial);
  const [assetsText, setAssetsText] = useState(initial.assets.join(", "));
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof NoteDraft>(k: K, v: NoteDraft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const save = useMutation({
    mutationFn: () => {
      const body = {
        ...draft,
        eventId: draft.eventId,
        assets: assetsText.split(/[\s,]+/).map((s) => s.trim().toUpperCase()).filter(Boolean),
        sources: draft.sources.filter((s) => s.label.trim()).map((s) => ({ label: s.label.trim(), url: s.url?.trim() ? s.url.trim() : null, itemId: s.itemId ?? null })),
      };
      return noteId ? apiFetch<NoteDTO>(`/api/notes/${noteId}`, { method: "PUT", body }) : apiFetch<NoteDTO>("/api/notes", { method: "POST", body });
    },
    onSuccess: (n) => {
      setError(null);
      push({ title: "Research note saved", body: n.title });
      onSaved(n);
    },
    onError: (e) =>
      setError(
        e instanceof ApiClientError
          ? `${e.message}${Array.isArray(e.details) ? `: ${(e.details as { path: string; message: string }[]).map((d) => `${d.path} ${d.message}`).join("; ")}` : ""}`
          : "Save failed",
      ),
  });
  const del = useMutation({ mutationFn: () => apiFetch(`/api/notes/${noteId}`, { method: "DELETE" }), onSuccess: () => onDeleted?.() });

  return (
    <form
      className="space-y-5"
      data-testid="note-editor"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_180px_170px]">
        <Field label="Title">
          <Input value={draft.title} onChange={(e) => set("title", e.target.value)} required maxLength={200} name="title" />
        </Field>
        <Field label="Status">
          <Select value={draft.status} onChange={(e) => set("status", e.target.value)}>
            {NOTE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {NOTE_STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Follow-up date">
          <Input type="date" value={draft.followUpDate ?? ""} onChange={(e) => set("followUpDate", e.target.value || null)} className="font-mono" />
        </Field>
      </div>
      {draft.eventRef && (
        <p className="text-xs text-fg-3">
          Linked event:{" "}
          <Link href={`/events/${draft.eventId}`} className="font-mono text-accent hover:underline">
            {draft.eventRef}
          </Link>
        </p>
      )}
      <Field label="Relevant assets" hint="Comma-separated symbols.">
        <Input value={assetsText} onChange={(e) => setAssetsText(e.target.value)} className="font-mono" placeholder="NVDA, TSM" />
      </Field>

      <div className="space-y-2">
        <span className="text-xs font-medium text-fg-2">Original sources</span>
        <ul className="space-y-2">
          {draft.sources.map((s, i) => (
            <li key={i} className="flex flex-wrap items-center gap-2 md:flex-nowrap">
              <Input value={s.label} aria-label="Source label" onChange={(e) => set("sources", draft.sources.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} className="md:w-72" />
              <Input value={s.url ?? ""} aria-label="Source URL" placeholder="https://… (leave empty if none)" onChange={(e) => set("sources", draft.sources.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))} className="font-mono text-xs" />
              {s.url && /^https?:\/\//.test(s.url) && (
                <a href={s.url} target="_blank" rel="noopener noreferrer nofollow" className="text-fg-3 hover:text-fg" aria-label="Open source">
                  <ExternalLink className="size-4" />
                </a>
              )}
              <button type="button" aria-label="Remove source" className="text-fg-3 hover:text-negative" onClick={() => set("sources", draft.sources.filter((_, j) => j !== i))}>
                <X className="size-4" />
              </button>
            </li>
          ))}
        </ul>
        <Button type="button" size="xs" variant="ghost" icon={<Plus className="size-3" />} onClick={() => set("sources", [...draft.sources, { label: "", url: null }])}>
          Add source
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {SECTIONS.map((s) => (
          <Field key={s.key} label={s.label} hint={s.hint} className={s.key === "summary" || s.key === "thesis" ? "lg:col-span-2" : undefined}>
            <Textarea value={String(draft[s.key] ?? "")} onChange={(e) => set(s.key, e.target.value as never)} name={s.key} />
          </Field>
        ))}
      </div>

      {error && (
        <p role="alert" className="text-xs text-negative">
          {error}
        </p>
      )}
      <div className="flex items-center gap-2">
        <Button type="submit" variant="primary" loading={save.isPending} data-testid="save-note">
          Save note
        </Button>
        {noteId && (
          <Button type="button" variant="danger" icon={<Trash2 className="size-3.5" />} onClick={() => confirm("Delete this note?") && del.mutate()} loading={del.isPending}>
            Delete
          </Button>
        )}
      </div>
    </form>
  );
}

export const blankNote = (): NoteDraft => ({
  eventId: null,
  eventRef: null,
  title: "",
  summary: "",
  sources: [],
  thesis: "",
  assets: [],
  transmission: "",
  bullish: "",
  bearish: "",
  alternatives: "",
  risks: "",
  evidenceNeeded: "",
  invalidation: "",
  followUpDate: null,
  status: "open",
});
