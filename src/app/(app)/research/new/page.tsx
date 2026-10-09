"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import type { NoteDTO } from "@/domain/dto";
import { apiFetch } from "@/lib/client/api";
import { blankNote, NoteEditor, type NoteDraft } from "@/components/research/note-editor";
import { ErrorState, PageHeader, Panel, SkeletonRows } from "@/components/ui/primitives";

function NewNote() {
  const params = useSearchParams();
  const eventId = params.get("event");
  const router = useRouter();
  const qc = useQueryClient();
  const draft = useQuery({
    queryKey: ["note-draft", eventId],
    queryFn: () => apiFetch<NoteDraft>(`/api/events/${eventId}/note-draft`),
    enabled: Boolean(eventId),
  });
  if (eventId && draft.isLoading) return <SkeletonRows rows={4} />;
  if (eventId && draft.error) return <ErrorState error={draft.error} onRetry={() => draft.refetch()} />;
  const initial = eventId && draft.data ? draft.data : blankNote();
  return (
    <div>
      <PageHeader title="New research note" description={eventId ? "Pre-filled from the event's stored evidence. Source links are the original links collected — none are generated." : undefined} />
      <Panel>
        <NoteEditor
          noteId={null}
          initial={initial}
          onSaved={async (n: NoteDTO) => {
            await qc.invalidateQueries({ queryKey: ["notes"] });
            router.replace(`/research/${n.id}`);
          }}
        />
      </Panel>
    </div>
  );
}

export default function NewNotePage() {
  return (
    <Suspense fallback={<SkeletonRows rows={4} />}>
      <NewNote />
    </Suspense>
  );
}
