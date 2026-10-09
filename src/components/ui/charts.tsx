"use client";

import { useState } from "react";
import { cn } from "@/lib/client/cn";

/**
 * Lightweight SVG charts. Specs: columns ≤ 24px with 4px rounded data-ends and
 * square baselines, 2px gaps, hairline solid gridlines, per-mark hover/focus
 * tooltips, text in text tokens (never the series colour), and a table view so
 * no value is gated behind hovering. Series colours are validated tokens
 * (--chart-1 / --chart-2).
 */
export interface ColumnDatum {
  key: string;
  label: string;
  /** Shown in tooltip and table (e.g. full timestamp). */
  detail: string;
  value: number;
}

function niceMax(v: number): number {
  if (v <= 4) return 4;
  const pow = 10 ** Math.floor(Math.log10(v));
  const n = v / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * pow;
}

export function ColumnChart({
  title,
  data,
  color = "var(--chart-1)",
  unit,
  labelEvery = 1,
  height = 120,
}: {
  title: string;
  data: ColumnDatum[];
  color?: string;
  unit: string;
  labelEvery?: number;
  height?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const max = niceMax(Math.max(0, ...data.map((d) => d.value)));
  const total = data.reduce((s, d) => s + d.value, 0);
  const width = 600;
  const padL = 28;
  const padB = 18;
  const plotH = height - padB - 6;
  const slot = (width - padL) / Math.max(1, data.length);
  const barW = Math.min(24, Math.max(2, slot - 2));
  const y = (v: number) => 6 + plotH - (v / max) * plotH;

  return (
    <figure className="min-w-0">
      <figcaption className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className="text-xs text-fg-2">
          {title} <span className="font-mono text-fg-3">· total {total.toLocaleString()}</span>
        </span>
        <button type="button" onClick={() => setTable((t) => !t)} className="text-2xs text-fg-3 underline-offset-2 hover:text-fg hover:underline">
          {table ? "Chart" : "Table"}
        </button>
      </figcaption>
      {table ? (
        <div className="max-h-48 overflow-y-auto rounded border border-line-subtle">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-2xs uppercase tracking-wider text-fg-3">
                <th className="px-2 py-1 font-medium">Period</th>
                <th className="px-2 py-1 text-right font-medium">{unit}</th>
              </tr>
            </thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.key} className="border-t border-line-subtle">
                  <td className="px-2 py-1 font-mono text-fg-2">{d.detail}</td>
                  <td className="px-2 py-1 text-right font-mono tabular text-fg">{d.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="relative">
          <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" role="img" aria-label={`${title}: ${total} ${unit} total`}>
            {[0, 0.5, 1].map((f) => (
              <g key={f}>
                <line x1={padL} x2={width} y1={y(max * f)} y2={y(max * f)} stroke="var(--chart-grid)" strokeWidth={1} />
                <text x={padL - 6} y={y(max * f) + 3} textAnchor="end" className="fill-[var(--fg-3)] font-mono" fontSize={9}>
                  {Math.round(max * f)}
                </text>
              </g>
            ))}
            {data.map((d, i) => {
              const x = padL + i * slot + (slot - barW) / 2;
              const h = Math.max(0, y(0) - y(d.value));
              const r = Math.min(4, h / 2, barW / 2);
              const top = y(d.value);
              const path =
                h <= 0
                  ? ""
                  : `M${x},${y(0)} L${x},${top + r} Q${x},${top} ${x + r},${top} L${x + barW - r},${top} Q${x + barW},${top} ${x + barW},${top + r} L${x + barW},${y(0)} Z`;
              return (
                <g key={d.key}>
                  {path && <path d={path} fill={color} opacity={hover === null || hover === i ? 1 : 0.55} />}
                  <rect
                    x={padL + i * slot}
                    y={6}
                    width={slot}
                    height={plotH}
                    fill="transparent"
                    tabIndex={0}
                    aria-label={`${d.detail}: ${d.value} ${unit}`}
                    onPointerEnter={() => setHover(i)}
                    onPointerLeave={() => setHover(null)}
                    onFocus={() => setHover(i)}
                    onBlur={() => setHover(null)}
                    className="cursor-default focus:outline-none"
                  />
                  {i % labelEvery === 0 && (
                    <text x={padL + i * slot + slot / 2} y={height - 4} textAnchor="middle" className="fill-[var(--fg-3)] font-mono" fontSize={9}>
                      {d.label}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
          {hover !== null && data[hover] && (
            <div
              className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 rounded border border-line bg-elevated px-2 py-1 shadow-lg"
              style={{ left: `${((padL + hover * slot + slot / 2) / width) * 100}%` }}
            >
              <p className="font-mono text-sm font-semibold text-fg">{data[hover].value}</p>
              <p className="flex items-center gap-1.5 whitespace-nowrap text-2xs text-fg-3">
                <span className="inline-block h-0.5 w-3 rounded" style={{ background: color }} aria-hidden />
                {unit} · {data[hover].detail}
              </p>
            </div>
          )}
        </div>
      )}
    </figure>
  );
}

/** Horizontal bars for a single measure (magnitude). Value sits at the bar tip in text ink. */
export function BarList({
  items,
  unit,
  color = "var(--chart-1)",
  empty,
}: {
  items: { key: string; label: string; value: number; sublabel?: string; href?: string }[];
  unit: string;
  color?: string;
  empty: string;
}) {
  if (items.length === 0) return <p className="py-4 text-center text-xs text-fg-3">{empty}</p>;
  const max = Math.max(...items.map((i) => i.value), 1);
  return (
    <ul className="space-y-2" aria-label={`Values in ${unit}`}>
      {items.map((it) => {
        const pct = (it.value / max) * 100;
        const label = (
          <span className="block truncate text-xs text-fg-2" title={it.sublabel}>
            {it.label}
            {it.sublabel && <span className="ml-1 text-2xs text-fg-3">{it.sublabel}</span>}
          </span>
        );
        return (
          <li key={it.key} className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] items-center gap-3" title={`${it.label}: ${it.value} ${unit}`}>
            {it.href ? (
              <a href={it.href} className="hover:text-fg">
                {label}
              </a>
            ) : (
              label
            )}
            <div className="flex items-center gap-2">
              <div className="h-2.5 rounded-r-[4px]" style={{ width: `max(${pct}%, 2px)`, background: color, maxWidth: "calc(100% - 2.5rem)" }} aria-hidden />
              <span className={cn("font-mono text-2xs tabular text-fg")}>{it.value}</span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
