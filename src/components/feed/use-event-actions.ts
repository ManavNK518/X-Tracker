"use client";

import { useMutation, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import type { FeedEventDTO, FeedPageDTO } from "@/domain/dto";
import { apiFetch } from "@/lib/client/api";
import { useToasts } from "@/components/providers/app-providers";

/** Save / mark-reviewed with optimistic updates across all cached feed pages. */
export function useEventActions() {
  const qc = useQueryClient();
  const { push } = useToasts();
  const patchCaches = (id: string, patch: Partial<FeedEventDTO["user"]>) => {
    qc.setQueriesData<InfiniteData<FeedPageDTO>>({ queryKey: ["feed"] }, (data) =>
      data
        ? { ...data, pages: data.pages.map((p) => ({ ...p, items: p.items.map((it) => (it.id === id ? { ...it, user: { ...it.user, ...patch } } : it)) })) }
        : data,
    );
    qc.setQueriesData<FeedEventDTO>({ queryKey: ["event", id] }, (data) => (data ? { ...data, user: { ...data.user, ...patch } } : data));
  };
  const mutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: { saved?: boolean; reviewed?: boolean } }) =>
      apiFetch<{ saved: boolean; reviewedAt: string | null }>(`/api/events/${id}/state`, { method: "POST", body }),
    onMutate: ({ id, body }) => {
      patchCaches(id, {
        ...(body.saved !== undefined ? { saved: body.saved } : {}),
        ...(body.reviewed !== undefined ? { reviewedAt: body.reviewed ? new Date().toISOString() : null } : {}),
      });
    },
    onSuccess: (res, { id }) => patchCaches(id, res),
    onError: (err, { id }) => {
      push({ title: "Could not update", body: (err as Error).message, tone: "error" });
      void qc.invalidateQueries({ queryKey: ["feed"] });
      void qc.invalidateQueries({ queryKey: ["event", id] });
    },
  });
  return {
    toggleSaved: (e: FeedEventDTO) => mutation.mutate({ id: e.id, body: { saved: !e.user.saved } }),
    toggleReviewed: (e: FeedEventDTO) => mutation.mutate({ id: e.id, body: { reviewed: !e.user.reviewedAt } }),
  };
}
