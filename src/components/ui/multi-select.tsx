"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/client/cn";

export interface Option {
  value: string;
  label: string;
  hint?: string;
}

export function MultiSelect({
  label,
  options,
  value,
  onChange,
  className,
  searchable,
}: {
  label: string;
  options: Option[];
  value: string[];
  onChange: (v: string[]) => void;
  className?: string;
  searchable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, []);
  const visible = filter ? options.filter((o) => o.label.toLowerCase().includes(filter.toLowerCase())) : options;
  const toggle = (v: string) => onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  return (
    <div className={cn("relative", className)} ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn(
          "inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-xs transition-colors",
          value.length ? "border-accent-line bg-accent-soft text-fg" : "border-line bg-surface text-fg-2 hover:text-fg",
        )}
      >
        {label}
        {value.length > 0 && <span className="rounded bg-accent px-1 font-mono text-[10px] font-semibold text-bg">{value.length}</span>}
        <ChevronDown className="size-3 text-fg-3" aria-hidden />
      </button>
      {open && (
        <div className="absolute left-0 top-8 z-40 w-64 rounded-md border border-line bg-elevated p-1 shadow-xl" role="listbox" aria-multiselectable="true" aria-label={label}>
          {searchable && (
            <input
              autoFocus
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter…"
              className="mb-1 h-7 w-full rounded border border-line bg-surface px-2 text-xs focus:outline-none"
            />
          )}
          <div className="max-h-72 overflow-y-auto">
            {visible.map((o) => (
              <label key={o.value} className="flex cursor-pointer items-start gap-2 rounded px-2 py-1.5 text-xs hover:bg-hover">
                <input type="checkbox" checked={value.includes(o.value)} onChange={() => toggle(o.value)} className="mt-0.5 size-3 accent-[var(--accent)]" />
                <span className="flex-1">
                  {o.label}
                  {o.hint && <span className="block text-2xs text-fg-3">{o.hint}</span>}
                </span>
              </label>
            ))}
            {visible.length === 0 && <p className="px-2 py-2 text-xs text-fg-3">No options</p>}
          </div>
          {value.length > 0 && (
            <button type="button" className="mt-1 w-full rounded px-2 py-1 text-left text-2xs text-fg-3 hover:bg-hover hover:text-fg" onClick={() => onChange([])}>
              Clear selection
            </button>
          )}
        </div>
      )}
    </div>
  );
}
