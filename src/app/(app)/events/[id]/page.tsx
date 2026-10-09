"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Bookmark,
  BookmarkCheck,
  CheckCheck,
  ExternalLink,
  FileText,
  Lightbulb,
  NotebookPen,
  ShieldCheck,
} from "lucide-react";
import type { EventDetailDTO, ScoreComponentDTO } from "@/domain/dto";
import { categoryLabel } from "@/domain/categories";
import { ASSET_RELATION_LABELS, FEEDBACK_LABEL_TEXT, FEEDBACK_LABELS, ITEM_ROLE_LABELS, type AssetRelation, type ItemRole } from "@/domain/misc";
import { VERIFICATION_META, isVerificationState } from "@/domain/verification";
import { apiFetch } from "@/lib/client/api";
import { cn } from "@/lib/client/cn";
import { useToasts } from "@/components/providers/app-providers";
import { useEventActions } from "@/components/feed/use-event-actions";
import {
  Badge,
  bandTone,
  CategoryTag,
  ConfidenceScore,
  DemoBadge,
  ImportanceScore,
  LifecycleBadge,
  ScoreBar,
  SourceTypeLabel,
  TickerChip,
  VerificationBadge,
} from "@/components/ui/badges";
import { Button, ErrorState, Panel, Skeleton } from "@/components/ui/primitives";
import { Age, Timestamp } from "@/components/ui/time";

export default function EventPage() {
  const { id } = useParams<{ id: string }>();
  const q = useQuery({ queryKey: ["event", id], queryFn: () => apiFetch<EventDetailDTO>(`/api/events/${id}`) });
  if (q.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-8 w-3/4" />
        <div className="grid gap-4 lg:grid-cols-3">
          <Skeleton className="h-64 lg:col-span-2" />
          <Skeleton className="h-64" />
        </div>
      </div>
    );
  }
  if (q.error || !q.data) return <ErrorState error={q.error ?? new Error("Not found")} onRetry={() => q.refetch()} />;
  return <EventDetail e={q.data} />;
}

function Section({ title, icon, children, tone, testId }: { title: string; icon?: ReactNode; children: ReactNode; tone?: "fact" | "interpretation"; testId?: string }) {
  return (
    <section className="rounded-lg border border-line bg-surface" data-testid={testId}>
      <header className="flex items-center justify-between gap-2 border-b border-line-subtle px-4 py-2.5">
        <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-fg-2">
          {icon}
          {title}
        </h2>
        {tone === "fact" && <Badge tone="positive">Source-attributed</Badge>}
        {tone === "interpretation" && <Badge tone="info">Interpretation — not verified fact</Badge>}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

function List({ items, empty }: { items: string[]; empty?: string }) {
  if (!items.length) return <p className="text-xs text-fg-3">{empty ?? "None."}</p>;
  return (
    <ul className="space-y-1.5 text-sm leading-relaxed text-fg-2">
      {items.map((t, i) => (
        <li key={i} className="flex gap-2">
          <span className="mt-2 size-1 shrink-0 rounded-full bg-fg-3" aria-hidden />
          <span>{t}</span>
        </li>
      ))}
    </ul>
  );
}

function ComponentsTable({ components, policy }: { components: ScoreComponentDTO[]; policy: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-2xs uppercase tracking-wider text-fg-3">
            <th className="pb-1.5 font-medium">Component</th>
            <th className="whitespace-nowrap pb-1.5 pl-2 text-right font-medium">Weight</th>
            <th className="whitespace-nowrap pb-1.5 pl-3 text-right font-medium">Score</th>
            <th className="whitespace-nowrap pb-1.5 pl-3 text-right font-medium">Pts</th>
          </tr>
        </thead>
        <tbody>
          {components.map((c) => (
            <tr key={c.id} className="border-t border-line-subtle align-top">
              <td className="py-1.5 pr-2">
                <p className="text-fg">{c.label}</p>
                <p className="mt-0.5 text-2xs leading-snug text-fg-3">{c.explanation}</p>
                {c.evidence.length > 0 && c.evidence[0] !== c.explanation && (
                  <ul className="mt-0.5 text-2xs text-fg-3">
                    {c.evidence.slice(0, 3).map((ev, i) => (
                      <li key={i}>– {ev}</li>
                    ))}
                  </ul>
                )}
              </td>
              <td className="whitespace-nowrap py-1.5 pl-2 text-right font-mono text-fg-3">{c.weight ? `${Math.round(c.weight * 100)}%` : "—"}</td>
              <td className="whitespace-nowrap py-1.5 pl-3 text-right font-mono">
                {c.weight === 0 ? <span className="font-sans text-2xs text-warning">applied</span> : c.score === null ? <span className="text-warning">unknown</span> : c.score}
              </td>
              <td className="whitespace-nowrap py-1.5 pl-3 text-right font-mono text-fg-2">{c.weight ? c.contribution.toFixed(1) : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-2xs text-fg-3">
        Unknown-component policy: <span className="font-mono">{policy}</span> — components that cannot be assessed contribute 0 points, so the total is a lower bound.
      </p>
    </div>
  );
}

function EventDetail({ e }: { e: EventDetailDTO }) {
  const qc = useQueryClient();
  const { push } = useToasts();
  const { toggleSaved, toggleReviewed } = useEventActions();
  const [showAllItems, setShowAllItems] = useState(false);
  const feedback = useMutation({
    mutationFn: (body: { label: string; remove?: boolean }) => apiFetch<{ labels: string[] }>(`/api/events/${e.id}/feedback`, { method: "POST", body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["event", e.id] });
      push({ title: "Feedback recorded", body: "Used for evaluation metrics only. Scoring is not changed automatically." });
    },
  });
  const tone = bandTone(e.importance);
  const verificationMeta = isVerificationState(e.verificationStatus) ? VERIFICATION_META[e.verificationStatus] : null;
  const ai = e.analysis.ai;
  const sortedItems = [...e.items].sort((a, b) => (a.publishedAt ?? a.collectedAt).localeCompare(b.publishedAt ?? b.collectedAt));
  const visibleItems = showAllItems ? sortedItems : sortedItems.slice(0, 8);
  const groups = new Map<string, number>();
  sortedItems.forEach((it) => groups.has(it.independenceKey) || groups.set(it.independenceKey, groups.size + 1));
  const origin = e.items.find((i) => i.role === "origin");

  return (
    <div className="space-y-4" data-testid="event-detail">
      <Link href="/feed" className="inline-flex items-center gap-1 text-xs text-fg-3 hover:text-fg">
        <ArrowLeft className="size-3.5" /> Back to feed
      </Link>

      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-xs text-fg-3">{e.ref}</span>
          {e.isDemo && <DemoBadge />}
          <LifecycleBadge state={e.lifecycle} />
          <VerificationBadge status={e.verificationStatus} />
          {e.categories.map((c) => (
            <Badge key={c}>{categoryLabel(c)}</Badge>
          ))}
        </div>
        <h1 className="max-w-4xl text-xl font-semibold leading-snug tracking-tight">{e.title}</h1>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-3">
          {e.origin && (
            <span>
              <span className="text-fg-2">{e.origin.sourceName}</span>
              {e.origin.handle && e.origin.provider !== "rss" && <span className="ml-1 font-mono">@{e.origin.handle}</span>} · <SourceTypeLabel category={e.origin.sourceCategory} />
            </span>
          )}
          <span>
            Published <Timestamp value={e.firstPublishedAt} seconds className="text-fg-2" /> (<Age value={e.firstPublishedAt} /> ago)
          </span>
          <span>
            First detected <Timestamp value={e.firstSeenAt} seconds />
          </span>
          <span>
            Last verification check <Timestamp value={e.lastVerifiedAt} />
          </span>
        </div>
        <div className="flex flex-wrap gap-2 pt-1">
          <Button size="sm" variant={e.user.saved ? "accent" : "secondary"} icon={e.user.saved ? <BookmarkCheck className="size-3.5" /> : <Bookmark className="size-3.5" />} onClick={() => toggleSaved(e)}>
            {e.user.saved ? "Saved" : "Save"}
          </Button>
          <Button size="sm" variant={e.user.reviewedAt ? "accent" : "secondary"} icon={<CheckCheck className="size-3.5" />} onClick={() => toggleReviewed(e)}>
            {e.user.reviewedAt ? "Reviewed" : "Mark reviewed"}
          </Button>
          {e.origin?.url && (
            <a href={e.origin.url} target="_blank" rel="noopener noreferrer nofollow">
              <Button size="sm" variant="secondary" icon={<ExternalLink className="size-3.5" />}>
                Original source
              </Button>
            </a>
          )}
          <Link href={`/research/new?event=${e.id}`}>
            <Button size="sm" variant="secondary" icon={<NotebookPen className="size-3.5" />} data-testid="create-note">
              Create research note
            </Button>
          </Link>
        </div>
      </header>

      {e.explanation.warnings.length > 0 && (
        <div role="note" className="space-y-1 rounded-md border border-warning/30 bg-warning-soft px-4 py-2.5">
          {e.explanation.warnings.map((w, i) => (
            <p key={i} className="flex items-start gap-2 text-xs text-warning">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              {w}
            </p>
          ))}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-4">
          <Section title="What happened — statements by sources" icon={<FileText className="size-3.5" />} tone="fact" testId="what-happened">
            <p className="mb-3 text-2xs text-fg-3">Verbatim excerpts, attributed to who published them. A statement being published is a fact; its content is only as reliable as the verification below.</p>
            <ul className="space-y-3">
              {e.explanation.statements.slice(0, 5).map((s) => (
                <li key={s.itemId} className="border-l-2 border-line pl-3">
                  <div className="flex flex-wrap items-center gap-2 text-2xs text-fg-3">
                    <span className="font-medium text-fg-2">{s.sourceName}</span>
                    <Badge>{ITEM_ROLE_LABELS[s.role as ItemRole] ?? s.role}</Badge>
                    <Timestamp value={s.publishedAt} seconds />
                    {s.url ? (
                      <a href={s.url} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 text-fg-2 hover:text-fg">
                        open <ExternalLink className="size-3" />
                      </a>
                    ) : (
                      <span>{e.isDemo ? "sample data — no original link" : "no link available"}</span>
                    )}
                  </div>
                  <blockquote className="mt-1 text-sm leading-relaxed text-fg">“{s.excerpt}”</blockquote>
                </li>
              ))}
            </ul>
            {ai.provided && ai.summary && (
              <div className="mt-4 rounded-md border border-info/25 bg-info-soft p-3">
                <p className="text-2xs font-semibold uppercase tracking-wider text-info">AI-generated summary ({ai.model}) — may contain errors; check the source text</p>
                <p className="mt-1 text-sm text-fg-2">{ai.summary}</p>
              </div>
            )}
          </Section>

          <Section title="Verification" icon={<ShieldCheck className="size-3.5" />} testId="verification">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <h3 className="mb-1.5 text-xs font-semibold text-positive">What is directly verified</h3>
                <List items={e.explanation.verified} />
              </div>
              <div>
                <h3 className="mb-1.5 text-xs font-semibold text-warning">What remains uncertain</h3>
                <List items={e.explanation.unverified} empty="Nothing flagged — but absence of contradiction is not verification." />
              </div>
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-line-subtle pt-3 text-xs md:grid-cols-4">
              <div>
                <dt className="text-2xs uppercase tracking-wider text-fg-3">Status</dt>
                <dd className="mt-1">
                  <VerificationBadge status={e.verificationStatus} />
                </dd>
              </div>
              <div>
                <dt className="text-2xs uppercase tracking-wider text-fg-3">Primary source</dt>
                <dd className="mt-1 text-fg-2">
                  {e.items.some((i) => i.source?.isPrimary && ["origin", "primary_source", "corroboration", "update"].includes(i.role)) ? "Located" : "Not located"}
                </dd>
              </div>
              <div>
                <dt className="text-2xs uppercase tracking-wider text-fg-3">Items / independent</dt>
                <dd className="mt-1 font-mono text-fg-2">
                  {e.sourceCount} / {e.independentSourceCount}
                </dd>
              </div>
              <div>
                <dt className="text-2xs uppercase tracking-wider text-fg-3">Last attempt</dt>
                <dd className="mt-1 text-fg-2">
                  {e.verificationAttempts[0] ? (
                    <>
                      <Timestamp value={e.verificationAttempts[0].attemptedAt} /> · {e.verificationAttempts[0].status}
                    </>
                  ) : (
                    "Not completed"
                  )}
                </dd>
              </div>
            </dl>
            {verificationMeta && <p className="mt-3 text-2xs text-fg-3">Criteria for “{verificationMeta.label}”: {verificationMeta.criteria}</p>}
          </Section>

          <Section title="Source timeline & evidence" testId="source-evidence">
            <p className="mb-3 text-2xs text-fg-3">
              Items sharing an independence group (same organisation, repost/quote, or attribution) are <strong className="font-semibold text-fg-2">not</strong> independent confirmation. Group numbers mark the underlying origin.
            </p>
            <ol className="relative space-y-3 border-l border-line pl-4">
              {visibleItems.map((it) => (
                <li key={it.itemId} className="relative" data-testid="evidence-item" data-role={it.role}>
                  <span
                    className={cn(
                      "absolute -left-[21px] top-1.5 size-2.5 rounded-full border-2 border-surface",
                      it.role === "contradiction" ? "bg-negative" : it.role === "correction" ? "bg-warning" : it.role === "corroboration" || it.role === "primary_source" ? "bg-positive" : it.role === "origin" ? "bg-accent" : "bg-fg-3",
                    )}
                    aria-hidden
                  />
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-2xs text-fg-3">
                    <Timestamp value={it.publishedAt} seconds className="text-fg-2" />
                    <span className="font-medium text-fg">{it.source?.name ?? it.authorName ?? it.authorHandle ?? "Unknown account"}</span>
                    {it.authorHandle && it.provider !== "rss" && <span className="font-mono">@{it.authorHandle}</span>}
                    {it.source ? <SourceTypeLabel category={it.source.category} /> : <span className="text-warning">unregistered</span>}
                    {it.source?.isPrimary && <Badge tone="info">primary source</Badge>}
                    <Badge tone={it.role === "contradiction" ? "negative" : it.role === "correction" ? "warning" : it.role === "corroboration" || it.role === "primary_source" ? "positive" : "neutral"}>
                      {ITEM_ROLE_LABELS[it.role as ItemRole] ?? it.role}
                    </Badge>
                    <span className="font-mono" title={it.independenceKey}>
                      group {groups.get(it.independenceKey)}
                    </span>
                    {it.isDemo && <DemoBadge />}
                  </div>
                  <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-fg-2">
                    {it.text ?? <span className="italic text-fg-3">Content no longer available ({it.contentStatus}). Metadata retained.</span>}
                  </p>
                  <div className="mt-1 flex flex-wrap gap-3 text-2xs text-fg-3">
                    <span>
                      collected <Timestamp value={it.collectedAt} seconds />
                    </span>
                    {it.similarity !== null && it.role !== "origin" && <span className="font-mono">similarity {it.similarity.toFixed(2)}</span>}
                    {it.note && it.role !== "origin" && <span>{it.note}</span>}
                    {it.analysis?.flags.length ? <span className="text-warning">flags: {it.analysis.flags.join(", ")}</span> : null}
                    {it.url ? (
                      <a href={it.url} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 hover:text-fg">
                        original <ExternalLink className="size-3" />
                      </a>
                    ) : null}
                  </div>
                </li>
              ))}
            </ol>
            {sortedItems.length > 8 && (
              <Button size="xs" variant="ghost" className="mt-3" onClick={() => setShowAllItems((v) => !v)}>
                {showAllItems ? "Show fewer" : `Show all ${sortedItems.length} items`}
              </Button>
            )}
          </Section>

          {e.contradictions.length > 0 && (
            <Section title="Contradictory information" icon={<AlertTriangle className="size-3.5 text-negative" />}>
              <ul className="space-y-2 text-sm text-fg-2">
                {e.contradictions.map((c) => {
                  const item = e.items.find((i) => i.itemId === c.itemId);
                  return (
                    <li key={c.id} className="rounded-md border border-negative/25 bg-negative-soft p-3">
                      <p>{c.description}</p>
                      {item?.text && <blockquote className="mt-1 text-xs text-fg-2">“{item.text}”</blockquote>}
                      <p className="mt-1 text-2xs text-fg-3">
                        {c.resolved ? "Resolved" : "Unresolved"} · <Timestamp value={c.createdAt} />
                        {item?.url && (
                          <a href={item.url} target="_blank" rel="noopener noreferrer nofollow" className="ml-2 inline-flex items-center gap-1 hover:text-fg">
                            source <ExternalLink className="size-3" />
                          </a>
                        )}
                      </p>
                    </li>
                  );
                })}
              </ul>
              {origin && <p className="mt-2 text-2xs text-fg-3">Both sides are shown. The original claim appears in the source timeline above.</p>}
            </Section>
          )}

          <Section title="Interpretation & research prompts" icon={<Lightbulb className="size-3.5" />} tone="interpretation" testId="interpretation">
            <div className="grid gap-5 md:grid-cols-2">
              <div>
                <h3 className="mb-1.5 text-xs font-semibold text-fg">Plausible transmission mechanism</h3>
                <List items={e.analysis.transmission} empty="No transmission channel identified." />
              </div>
              <div>
                <h3 className="mb-1.5 text-xs font-semibold text-fg">What could make this important</h3>
                <List items={e.analysis.importanceDrivers} />
              </div>
              <div>
                <h3 className="mb-1.5 text-xs font-semibold text-fg">What would make it less important than it appears</h3>
                <List items={e.analysis.importanceReducers} />
              </div>
              <div>
                <h3 className="mb-1.5 text-xs font-semibold text-fg">Evidence a researcher should seek</h3>
                <List items={[...e.analysis.claimsToVerify, ...e.analysis.evidenceToSeek]} />
              </div>
              <div>
                <h3 className="mb-1.5 text-xs font-semibold text-fg">Bullish interpretation</h3>
                <p className="text-sm text-fg-2">{e.analysis.bullish ?? (ai.provided ? "Not supported by the content." : "Not assessed (no AI analysis for this event).")}</p>
              </div>
              <div>
                <h3 className="mb-1.5 text-xs font-semibold text-fg">Bearish interpretation</h3>
                <p className="text-sm text-fg-2">{e.analysis.bearish ?? (ai.provided ? "Not supported by the content." : "Not assessed (no AI analysis for this event).")}</p>
              </div>
              <div className="md:col-span-2">
                <h3 className="mb-1.5 text-xs font-semibold text-fg">Key uncertainties</h3>
                <List items={e.analysis.keyUncertainties} />
              </div>
            </div>
            <p className="mt-4 border-t border-line-subtle pt-3 text-2xs text-fg-3">
              AI analysis: {ai.provided ? `provided by ${ai.model}` : `not available (${ai.status.replace(/_/g, " ")})`}. Items prefixed “AI:” are model-generated hypotheses; claims are only kept when the model quotes the source verbatim.
              {ai.warnings.length > 0 && ` Validation notes: ${ai.warnings.join("; ")}.`}
            </p>
          </Section>
        </div>

        <aside className="min-w-0 space-y-4">
          <Panel title="Scores" subtitle="Importance prioritises research. Confidence measures evidence. Neither is a probability of price movement.">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5" data-testid="importance-score">
                <ImportanceScore value={e.importance} size="lg" coverage={e.importanceCoverage} />
                <ScoreBar value={e.importance} coverage={e.importanceCoverage} />
                <p className={cn("text-2xs", tone.text)}>{tone.band}</p>
                <p className="text-2xs text-fg-3">Evidence coverage {Math.round(e.importanceCoverage * 100)}%</p>
              </div>
              <div className="space-y-1.5" data-testid="confidence-score">
                <ConfidenceScore value={e.confidence} size="lg" />
                <ScoreBar value={e.confidence} coverage={e.confidenceCoverage} tone="positive" />
                <p className="text-2xs text-fg-3">Coverage {Math.round(e.confidenceCoverage * 100)}%</p>
              </div>
            </div>
          </Panel>

          <Panel title="Importance breakdown">
            <ComponentsTable components={e.importanceComponents} policy="conservative" />
          </Panel>
          <Panel title="Confidence breakdown">
            <ComponentsTable components={e.confidenceComponents} policy="conservative" />
          </Panel>

          <Panel title="Potentially affected assets" subtitle="Possible relationships, not predicted reactions.">
            {e.assetDetails.length === 0 ? (
              <p className="text-xs text-fg-3">Unknown — no asset could be identified confidently.</p>
            ) : (
              <ul className="space-y-2.5">
                {e.assetDetails.map((a) => (
                  <li key={a.symbol} className="text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1.5">
                        <TickerChip symbol={a.symbol} relation={a.relation} />
                        <span className="text-fg-2">{a.name}</span>
                      </span>
                      <span className="font-mono text-2xs text-fg-3">{Math.round(a.confidence * 100)}%</span>
                    </div>
                    <p className="mt-0.5 text-2xs text-fg-3">
                      {ASSET_RELATION_LABELS[a.relation as AssetRelation] ?? a.relation} · {a.method}: {a.rationale}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Classification">
            <ul className="space-y-2 text-xs">
              {e.classifications.map((c) => (
                <li key={`${c.category}-${c.method}`}>
                  <div className="flex items-center justify-between">
                    <CategoryTag category={c.category} />
                    <span className="font-mono text-2xs text-fg-3">
                      {c.method} · {c.score.toFixed(2)}
                    </span>
                  </div>
                  <p className="mt-0.5 text-2xs text-fg-3">{c.evidence.slice(0, 3).join("; ")}</p>
                </li>
              ))}
            </ul>
            <div className="mt-3 border-t border-line-subtle pt-2 text-2xs text-fg-3">
              <p className="mb-1 font-semibold uppercase tracking-wider">Why it was detected</p>
              <List items={e.explanation.whyDetected} />
            </div>
          </Panel>

          <Panel title="Score audit trail">
            <ol className="space-y-2 text-xs" data-testid="score-history">
              {e.scoreHistory.map((h) => (
                <li key={h.id} className="border-l border-line pl-2.5">
                  <div className="flex items-center justify-between font-mono text-2xs">
                    <Timestamp value={h.createdAt} seconds className="text-fg-3" />
                    <span className="text-fg-2">
                      imp {h.importance} · conf {h.confidence}
                    </span>
                  </div>
                  <p className="text-2xs text-fg-3">
                    {h.reason} · <span className="font-mono">{h.verificationStatus}</span> · v{h.scoringVersion}
                  </p>
                </li>
              ))}
            </ol>
          </Panel>

          <Panel title="Your alerts for this event">
            {e.alertDecisions.length === 0 ? (
              <p className="text-xs text-fg-3">No alert evaluation recorded for you yet.</p>
            ) : (
              <ul className="space-y-1.5 text-xs">
                {e.alertDecisions.map((d, i) => (
                  <li key={i}>
                    <span className="font-mono text-2xs text-fg-3">
                      v{d.materialVersion} <Timestamp value={d.createdAt} />
                    </span>{" "}
                    <span className={d.decision === "notified" ? "text-positive" : "text-fg-2"}>{d.decision.replace(/_/g, " ")}</span>
                    <p className="text-2xs text-fg-3">{d.reasons.join(" | ")}</p>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Feedback" subtitle="Labels feed evaluation metrics. They never change production scoring automatically.">
            <div className="flex flex-wrap gap-1.5" data-testid="feedback">
              {FEEDBACK_LABELS.map((l) => {
                const on = e.feedback.includes(l);
                return (
                  <Button key={l} size="xs" variant={on ? "accent" : "secondary"} aria-pressed={on} loading={feedback.isPending && feedback.variables?.label === l} onClick={() => feedback.mutate({ label: l, remove: on })}>
                    {FEEDBACK_LABEL_TEXT[l]}
                  </Button>
                );
              })}
            </div>
          </Panel>

          {e.notes.length > 0 && (
            <Panel title="Research notes">
              <ul className="space-y-1 text-xs">
                {e.notes.map((n) => (
                  <li key={n.id}>
                    <Link href={`/research/${n.id}`} className="text-fg hover:text-accent">
                      {n.title}
                    </Link>{" "}
                    <span className="text-2xs text-fg-3">· {n.status}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </aside>
      </div>
    </div>
  );
}
