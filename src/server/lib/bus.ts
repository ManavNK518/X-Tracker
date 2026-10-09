import { EventEmitter } from "node:events";

/**
 * In-process event bus used to push changes to Server-Sent Event streams
 * immediately. It is an optimisation only: SSE streams also reconcile from the
 * database, so a separate worker process (no shared bus) still works.
 */
export type BusMessage =
  | { type: "event.changed"; eventId: string; change: "created" | "updated"; isDemo: boolean }
  | { type: "notification.created"; userId: string; notificationId: string }
  | { type: "status.changed" };

type GlobalWithBus = typeof globalThis & { __signalBus?: EventEmitter };
const g = globalThis as GlobalWithBus;

function emitter(): EventEmitter {
  if (!g.__signalBus) {
    g.__signalBus = new EventEmitter();
    g.__signalBus.setMaxListeners(500);
  }
  return g.__signalBus;
}

export function publish(message: BusMessage): void {
  emitter().emit("message", message);
}

export function subscribe(listener: (message: BusMessage) => void): () => void {
  emitter().on("message", listener);
  return () => emitter().off("message", listener);
}
