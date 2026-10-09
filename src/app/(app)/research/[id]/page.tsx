"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import type { NoteDTO } from "@/domain/dto";
import { apiFetch } from "@/lib/client/api";
import { NoteEditor } from "@/components/research/note-editor";
import { ErrorState, PageHeader, Panel, SkeletonRows } from "@/components/ui/primitives";
import { Timestamp } from "@/components/ui/time";

export default function NotePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const note = useQuery({ queryKey: ["note", id], queryFn: () => apiFetch<NoteDTO>(`/api/notes/${id}`) });
  if (note.isLoading) return <SkeletonRows rows={5} />;
  if (note.error || !note.data) return <ErrorState error={note.error} onRetry={() => note.refetch()} />;
  const n = note.data;
  return (
    <div>
      <Link href="/research" className="mb-3 inline-flex items-center gap-1 text-xs text-fg-3 hover:text-fg">
        <ArrowLeft className="size-3.5" /> All notes
      </Link>
      <PageHeader
        title={n.title}
        description={
          <>
            Created <Timestamp value={n.createdAt} /> · updated <Timestamp value={n.updatedAt} />
          </>
        }
      />
      <Panel>
        <NoteEditor
          key={n.updatedAt}
          noteId={n.id}
          initial={n}
          onSaved={(saved) => {
            qc.setQueryData(["note", id], saved);
            void qc.invalidateQueries({ queryKey: ["notes"] });
          }}
          onDeleted={async () => {
            await qc.invalidateQueries({ queryKey: ["notes"] });
            router.replace("/research");
          }}
        />
      </Panel>
    </div>
  );
}
