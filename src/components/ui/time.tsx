"use client";

import { useSyncExternalStore } from "react";
import { formatAge, formatDateTime, formatTime } from "@/lib/time";
import { useMe } from "@/components/providers/app-providers";

/**
 * Shared ticking clocks (one interval per resolution, shared by all
 * subscribers). The server snapshot is null so time-relative text is only
 * rendered on the client and never causes a hydration mismatch.
 */
interface Clock {
  subscribe: (onChange: () => void) => () => void;
  getSnapshot: () => Date;
}
const clocks = new Map<number, Clock>();
const serverSnapshot = () => null;

function createClock(intervalMs: number): Clock {
  let now: Date | null = null;
  let timer: ReturnType<typeof setInterval> | undefined;
  const listeners = new Set<() => void>();
  return {
    subscribe(onChange) {
      listeners.add(onChange);
      if (!timer) {
        timer = setInterval(() => {
          now = new Date();
          listeners.forEach((l) => l());
        }, intervalMs);
      }
      return () => {
        listeners.delete(onChange);
        if (listeners.size === 0 && timer) {
          clearInterval(timer);
          timer = undefined;
        }
      };
    },
    getSnapshot() {
      if (!now) now = new Date();
      return now;
    },
  };
}

function clockFor(intervalMs: number): Clock {
  let clock = clocks.get(intervalMs);
  if (!clock) {
    clock = createClock(intervalMs);
    clocks.set(intervalMs, clock);
  }
  return clock;
}

export function useNow(intervalMs = 30_000): Date | null {
  const clock = clockFor(intervalMs);
  return useSyncExternalStore(clock.subscribe, clock.getSnapshot, serverSnapshot);
}

export function useTimeZone(): string {
  const me = useMe();
  return me?.preferences.timezone ?? "UTC";
}

/** Absolute timestamp in the user's time zone (stored values are UTC). */
export function Timestamp({
  value,
  seconds,
  dateOnly,
  timeOnly,
  className,
}: {
  value: string | null | undefined;
  seconds?: boolean;
  dateOnly?: boolean;
  timeOnly?: boolean;
  className?: string;
}) {
  const tz = useTimeZone();
  if (!value) return <span className={className}>—</span>;
  const text = dateOnly ? formatDateTime(value, tz).slice(0, 10) : timeOnly ? formatTime(value, tz, seconds) : formatDateTime(value, tz, seconds);
  return (
    <time dateTime={value} title={`${value} (UTC) — shown in ${tz}`} className={`font-mono tabular ${className ?? ""}`}>
      {text}
    </time>
  );
}

export function Clock() {
  const now = useNow(1_000);
  const tz = useTimeZone();
  return (
    <span className="font-mono text-xs tabular text-fg-2" title={`Time zone: ${tz}`}>
      {now ? formatTime(now, tz) : "--:--:--"} <span className="text-fg-3">{tz === "UTC" ? "UTC" : tz.split("/").pop()?.replace(/_/g, " ")}</span>
    </span>
  );
}

export function Age({ value, className }: { value: string | null | undefined; className?: string }) {
  const now = useNow(15_000);
  if (!value) return <span className={className}>—</span>;
  return (
    <span className={`font-mono tabular ${className ?? ""}`} title="Time since publication">
      {now ? formatAge(value, now) : ""}
    </span>
  );
}
