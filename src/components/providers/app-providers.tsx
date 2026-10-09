"use client";

import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import type { ConnectionStateDTO, MeDTO } from "@/domain/dto";
import { apiFetch } from "@/lib/client/api";

// ---------------------------------------------------------------------------
// Current user
// ---------------------------------------------------------------------------

const MeContext = createContext<MeDTO | null>(null);
export const useMe = () => useContext(MeContext);

function MeProvider({ children }: { children: ReactNode }) {
  const { data } = useQuery({ queryKey: ["me"], queryFn: () => apiFetch<MeDTO>("/api/auth/me"), staleTime: 30_000 });
  useEffect(() => {
    if (data) document.documentElement.dataset.theme = data.preferences.theme === "light" ? "light" : "dark";
  }, [data]);
  return <MeContext.Provider value={data ?? null}>{children}</MeContext.Provider>;
}

// ---------------------------------------------------------------------------
// Live stream (SSE)
// ---------------------------------------------------------------------------

export type StreamStatus = "connecting" | "open" | "reconnecting" | "offline";
export interface StreamEvent {
  type: "event" | "notification";
  data: Record<string, unknown>;
}

interface StreamContextValue {
  status: StreamStatus;
  connection: ConnectionStateDTO | null;
  lastMessageAt: Date | null;
  subscribe: (fn: (e: StreamEvent) => void) => () => void;
}

const StreamContext = createContext<StreamContextValue>({
  status: "connecting",
  connection: null,
  lastMessageAt: null,
  subscribe: () => () => undefined,
});
export const useStream = () => useContext(StreamContext);

function StreamProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const me = useMe();
  const { push } = useToasts();
  const [status, setStatus] = useState<StreamStatus>("connecting");
  const [connection, setConnection] = useState<ConnectionStateDTO | null>(null);
  const [lastMessageAt, setLastMessageAt] = useState<Date | null>(null);
  const subscribers = useRef(new Set<(e: StreamEvent) => void>());
  const seenNotifications = useRef(new Set<string>());
  const browserEnabled = Boolean(me?.preferences.channels.browser);
  const browserRef = useRef(browserEnabled);
  useEffect(() => {
    browserRef.current = browserEnabled;
  }, [browserEnabled]);

  useEffect(() => {
    let source: EventSource | null = null;
    let retry = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    let invalidateTimer: ReturnType<typeof setTimeout> | undefined;

    const scheduleInvalidate = () => {
      clearTimeout(invalidateTimer);
      invalidateTimer = setTimeout(() => {
        void qc.invalidateQueries({ queryKey: ["overview"] });
        void qc.invalidateQueries({ queryKey: ["event"] });
      }, 1_500);
    };

    const connect = () => {
      if (disposed) return;
      setStatus(retry === 0 ? "connecting" : "reconnecting");
      source = new EventSource("/api/stream");
      source.onopen = () => {
        retry = 0;
        setStatus("open");
      };
      source.addEventListener("connection", (e) => {
        setLastMessageAt(new Date());
        try {
          setConnection(JSON.parse((e as MessageEvent).data));
        } catch {
          /* ignore malformed */
        }
      });
      source.addEventListener("event", (e) => {
        setLastMessageAt(new Date());
        try {
          const data = JSON.parse((e as MessageEvent).data);
          subscribers.current.forEach((fn) => fn({ type: "event", data }));
          scheduleInvalidate();
        } catch {
          /* ignore */
        }
      });
      source.addEventListener("notification", (e) => {
        setLastMessageAt(new Date());
        try {
          const data = JSON.parse((e as MessageEvent).data) as { id: string; title: string; kind: string; eventId: string; isDemo: boolean; payload?: { importance?: number } };
          if (seenNotifications.current.has(data.id)) return;
          seenNotifications.current.add(data.id);
          subscribers.current.forEach((fn) => fn({ type: "notification", data }));
          void qc.invalidateQueries({ queryKey: ["notifications"] });
          void qc.invalidateQueries({ queryKey: ["me"] });
          push({ title: `${data.isDemo ? "[SAMPLE] " : ""}${data.kind === "new" ? "New alert" : `Alert ${data.kind}`}`, body: data.title, href: `/events/${data.eventId}` });
          if (browserRef.current && typeof Notification !== "undefined" && Notification.permission === "granted" && document.visibilityState !== "visible") {
            new Notification(`${data.isDemo ? "[SAMPLE] " : ""}${data.title}`.slice(0, 120), { body: `Importance ${data.payload?.importance ?? "?"}/100 — open the investigation for evidence.`, tag: data.id });
          }
        } catch {
          /* ignore */
        }
      });
      source.onerror = () => {
        if (disposed) return;
        // EventSource retries on its own while CONNECTING; if it gave up, back off and reconnect.
        if (source && source.readyState === EventSource.CLOSED) {
          source.close();
          retry++;
          setStatus(retry > 5 ? "offline" : "reconnecting");
          timer = setTimeout(connect, Math.min(30_000, 1_000 * 2 ** Math.min(retry, 5)));
        } else {
          setStatus("reconnecting");
        }
      };
    };
    connect();
    const onOnline = () => {
      if (source?.readyState === EventSource.CLOSED) {
        retry = 0;
        connect();
      }
    };
    window.addEventListener("online", onOnline);
    return () => {
      disposed = true;
      clearTimeout(timer);
      clearTimeout(invalidateTimer);
      window.removeEventListener("online", onOnline);
      source?.close();
    };
  }, [qc, push]);

  const subscribe = useCallback((fn: (e: StreamEvent) => void) => {
    subscribers.current.add(fn);
    return () => {
      subscribers.current.delete(fn);
    };
  }, []);

  const value = useMemo(() => ({ status, connection, lastMessageAt, subscribe }), [status, connection, lastMessageAt, subscribe]);
  return <StreamContext.Provider value={value}>{children}</StreamContext.Provider>;
}

// ---------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------

interface Toast {
  id: number;
  title: string;
  body?: string;
  href?: string;
  tone?: "default" | "error";
}

const ToastContext = createContext<{ push: (t: Omit<Toast, "id">) => void }>({ push: () => undefined });
export const useToasts = () => useContext(ToastContext);

function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);
  const push = useCallback((t: Omit<Toast, "id">) => {
    const id = nextId.current++;
    setToasts((prev) => [...prev.slice(-3), { ...t, id }]);
    setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== id)), 7_000);
  }, []);
  const value = useMemo(() => ({ push }), [push]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto rounded-md border bg-elevated px-3 py-2.5 shadow-xl ${t.tone === "error" ? "border-negative/40" : "border-line"}`}
          >
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <p className={`text-xs font-semibold ${t.tone === "error" ? "text-negative" : "text-accent"}`}>{t.title}</p>
                {t.body &&
                  (t.href ? (
                    <a href={t.href} className="mt-0.5 line-clamp-2 block text-xs text-fg hover:underline">
                      {t.body}
                    </a>
                  ) : (
                    <p className="mt-0.5 line-clamp-2 text-xs text-fg">{t.body}</p>
                  ))}
              </div>
              <button className="text-fg-3 hover:text-fg" aria-label="Dismiss" onClick={() => setToasts((p) => p.filter((x) => x.id !== t.id))}>
                <X className="size-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

// ---------------------------------------------------------------------------

export function AppProviders({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: (count, error) => count < 2 && !(error as { status?: number })?.status?.toString().startsWith("4"), refetchOnWindowFocus: false, staleTime: 10_000 },
        },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MeProvider>
          <StreamProvider>{children}</StreamProvider>
        </MeProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}
