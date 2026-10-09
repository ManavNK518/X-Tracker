import { and, eq, gt } from "drizzle-orm";
import { api } from "@/server/api/handler";
import { events, notifications, userPreferences } from "@/server/db/schema";
import { subscribe } from "@/server/lib/bus";
import { getConnectionState } from "@/server/services/status";

/**
 * Server-Sent Events stream. Pushes event changes and the user's new
 * notifications. Changes are pushed immediately via the in-process bus and
 * also reconciled from the database every few seconds, so a separate worker
 * process works too. Clients reconnect automatically (EventSource) and dedupe
 * by event ID.
 */
export const GET = api({ auth: "user" }, async ({ req, db, env, user }) => {
  const userId = user!.id;
  const encoder = new TextEncoder();
  const [prefs] = await db.select({ showDemo: userPreferences.showDemo }).from(userPreferences).where(eq(userPreferences.userId, userId));
  const showDemo = prefs?.showDemo ?? true;
  let seq = 0;
  let cursorEvents = new Date();
  let cursorNotifs = new Date();
  let closed = false;
  let wake: (() => void) | null = null;
  const sentEventVersions = new Map<string, string>();

  const run = async (controller: ReadableStreamDefaultController<Uint8Array>) => {
    {
      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`id: ${++seq}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          closed = true;
        }
      };
      const comment = (text: string) => {
        if (!closed) controller.enqueue(encoder.encode(`: ${text}\n\n`));
      };
      controller.enqueue(encoder.encode("retry: 5000\n\n"));
      send("connection", await getConnectionState(db, env));

      const unsubscribe = subscribe((msg) => {
        if (msg.type === "event.changed" || (msg.type === "notification.created" && msg.userId === userId) || msg.type === "status.changed") {
          wake?.();
        }
      });

      const reconcile = async () => {
        const now = new Date();
        const changed = await db
          .select({ id: events.id, updatedAt: events.updatedAt, isDemo: events.isDemo, importance: events.importance, materialVersion: events.materialVersion })
          .from(events)
          .where(gt(events.updatedAt, cursorEvents))
          .limit(100);
        for (const e of changed) {
          if (e.isDemo && !showDemo) continue;
          const version = `${e.updatedAt.getTime()}`;
          if (sentEventVersions.get(e.id) === version) continue;
          sentEventVersions.set(e.id, version);
          send("event", { id: e.id, importance: e.importance, materialVersion: e.materialVersion, isDemo: e.isDemo });
        }
        if (changed.length) cursorEvents = new Date(Math.max(...changed.map((e) => e.updatedAt.getTime())) - 1);
        const notifs = await db
          .select({ id: notifications.id, title: notifications.title, kind: notifications.kind, eventId: notifications.eventId, isDemo: notifications.isDemo, createdAt: notifications.createdAt, payload: notifications.payload })
          .from(notifications)
          .where(and(eq(notifications.userId, userId), gt(notifications.createdAt, cursorNotifs)))
          .limit(50);
        for (const n of notifs) send("notification", { id: n.id, title: n.title, kind: n.kind, eventId: n.eventId, isDemo: n.isDemo, payload: n.payload });
        if (notifs.length) cursorNotifs = new Date(Math.max(...notifs.map((n) => n.createdAt.getTime())));
        if (sentEventVersions.size > 2_000) sentEventVersions.clear();
        void now;
      };

      let ticks = 0;
      try {
        while (!closed && !req.signal.aborted) {
          await new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, 3_000);
            wake = () => {
              clearTimeout(timer);
              resolve();
            };
          });
          wake = null;
          if (closed || req.signal.aborted) break;
          await reconcile();
          ticks++;
          if (ticks % 5 === 0) comment("ping");
          if (ticks % 10 === 0) send("connection", await getConnectionState(db, env));
        }
      } catch {
        // Database or stream errors end this connection; the client reconnects.
      } finally {
        unsubscribe();
        closed = true;
        try {
          controller.close();
        } catch {
          // already closed
        }
      }
    }
  };

  const stream = new ReadableStream<Uint8Array>({
    start: (controller) => {
      void run(controller);
    },
    cancel: () => {
      closed = true;
      wake?.();
    },
  });

  req.signal.addEventListener("abort", () => {
    closed = true;
    wake?.();
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
});
