"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { CalendarClock, Plus } from "lucide-react";
import type { NoteDTO } from "@/domain/dto";
import { NOTE_STATUS_LABELS, NOTE_STATUSES, type NoteStatus } from "@/domain/misc";
import { apiFetch, qs } from "@/lib/client/api";
import { Badge } from "@/components/ui/badges";
import { Button, EmptyState, ErrorState, Input, PageHeader, SkeletonRows, Tabs } from "@/components/ui/primitives";
import { Timestamp } from "@/components/ui/time";

export default function ResearchPage() {
  const [status, setStatus] = useState<NoteStatus | "all">("all");
  const [q, setQ] = useState("");
  const notes = useQuery({
    queryKey: ["notes", status, q],
    queryFn: () => apiFetch<NoteDTO[]>(`/api/notes${qs({ status: status === "all" ? undefined : status, q: q || undefined })}`),
  });
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div className="space-y-4">
      <PageHeader
        title="Research Workspace"
        description="Turn events into structured hypotheses with explicit evidence requirements and invalidation criteria, rather than reacting to headlines."
        actions={
          <Link href="/research/new">
            <Button size="sm" variant="accent" icon={<Plus className="size-3.5" />}>
              New note
            </Button>
          </Link>
        }
      />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <Tabs value={status} onChange={setStatus} tabs={[{ id: "all", label: "All" }, ...NOTE_STATUSES.map((s) => ({ id: s, label: NOTE_STATUS_LABELS[s] }))]} />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search notes" className="h-7 w-56 text-xs" aria-label="Search notes" />
      </div>
      <div className="overflow-hidden rounded-lg border border-line bg-surface">
        {notes.isLoading ? (
          <SkeletonRows rows={4} />
        ) : notes.error ? (
          <div className="p-4">
            <ErrorState error={notes.error} onRetry={() => notes.refetch()} />
          </div>
        ) : !notes.data?.length ? (
          <EmptyState title="No research notes" description="Open an event and choose “Create research note”, or start a blank note." />
        ) : (
          <ul className="divide-y divide-line-subtle" data-testid="notes-list">
            {notes.data.map((n) => {
              const due = n.followUpDate && n.followUpDate <= today && !["archived", "validated", "invalidated"].includes(n.status);
              return (
                <li key={n.id}>
                  <Link href={`/research/${n.id}`} className="block px-4 py-3 hover:bg-hover/60">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-fg">{n.title}</span>
                      <Badge tone={n.status === "validated" ? "positive" : n.status === "invalidated" ? "negative" : n.status === "investigating" ? "info" : "neutral"}>
                        {NOTE_STATUS_LABELS[n.status as NoteStatus] ?? n.status}
                      </Badge>
                      {n.eventRef && <span className="font-mono text-2xs text-fg-3">{n.eventRef}</span>}
                      {due && (
                        <Badge tone="warning">
                          <CalendarClock className="size-3" /> follow-up due
                        </Badge>
                      )}
                    </div>
                    {n.thesis && <p className="mt-1 line-clamp-1 text-xs text-fg-2">Thesis: {n.thesis}</p>}
                    <p className="mt-1 text-2xs text-fg-3">
                      Updated <Timestamp value={n.updatedAt} /> {n.assets.length > 0 && <span className="ml-2 font-mono">{n.assets.join(" ")}</span>}
                      {n.followUpDate && <span className="ml-2">follow-up {n.followUpDate}</span>}
                    </p>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
