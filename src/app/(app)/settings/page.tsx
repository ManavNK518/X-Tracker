"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { Suspense, useState, useSyncExternalStore } from "react";
import { BellRing, CheckCircle2, CircleDashed, RotateCcw, Send } from "lucide-react";
import type { MeDTO } from "@/domain/dto";
import { CHANNEL_LABELS, NOTIFICATION_CHANNELS } from "@/domain/misc";
import { IMPORTANCE_COMPONENT_LABELS, CONFIDENCE_COMPONENT_LABELS } from "@/config/scoring";
import { apiFetch, ApiClientError, hardNavigate } from "@/lib/client/api";
import { COMMON_TIME_ZONES, isValidTimeZone } from "@/lib/time";
import { useMe, useToasts } from "@/components/providers/app-providers";
import { Badge } from "@/components/ui/badges";
import { Button, Checkbox, Field, Input, PageHeader, Panel, Select, Skeleton, Tabs, Toggle } from "@/components/ui/primitives";

interface Info {
  integrations: { id: string; name: string; configured: boolean; cost: string; requires: string[]; model?: string; secEdgarConfigured?: boolean }[];
  database: string;
  workerMode: string;
  demoMode: boolean;
  budgets: Record<string, number>;
  retention: { xContentDays: number; rssContentDays: number; xComplianceRefreshHours: number; xComplianceMaxReadsPerDay: number };
  scoring: {
    version: string;
    importanceWeights: Record<string, number>;
    confidenceWeights: Record<string, number>;
    bands: { id: string; label: string; min: number }[];
    unknownPolicy: { policy: string; neutralValue: number };
  };
}

type Tab = "account" | "preferences" | "notifications" | "integrations" | "scoring" | "data" | "security";

function usePrefsMutation() {
  const qc = useQueryClient();
  const { push } = useToasts();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => apiFetch<MeDTO>("/api/preferences", { method: "PATCH", body }),
    onSuccess: (me) => {
      qc.setQueryData(["me"], me);
      void qc.invalidateQueries({ queryKey: ["feed"] });
      void qc.invalidateQueries({ queryKey: ["overview"] });
      push({ title: "Settings saved" });
    },
    onError: (e) => push({ title: "Could not save", body: e instanceof ApiClientError ? e.message : String(e), tone: "error" }),
  });
}

function Preferences({ me }: { me: MeDTO }) {
  const save = usePrefsMutation();
  const [tz, setTz] = useState(me.preferences.timezone);
  const browserTz = typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "UTC";
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel title="Display">
        <div className="space-y-4">
          <Field label="Time zone" hint="All timestamps are stored in UTC and displayed in this zone.">
            <div className="flex gap-2">
              <Select value={COMMON_TIME_ZONES.includes(tz) ? tz : "__custom"} onChange={(e) => e.target.value !== "__custom" && setTz(e.target.value)}>
                {COMMON_TIME_ZONES.map((z) => (
                  <option key={z} value={z}>
                    {z}
                  </option>
                ))}
                {!COMMON_TIME_ZONES.includes(tz) && <option value="__custom">{tz}</option>}
              </Select>
              <Button size="md" variant="secondary" onClick={() => setTz(browserTz)} title="Use your browser's time zone">
                Use {browserTz}
              </Button>
            </div>
            <Input value={tz} onChange={(e) => setTz(e.target.value)} className="mt-2 font-mono text-xs" aria-label="IANA time zone" />
          </Field>
          <Button variant="primary" size="sm" disabled={!isValidTimeZone(tz)} loading={save.isPending} onClick={() => save.mutate({ timezone: tz })}>
            Save time zone
          </Button>
          <Field label="Theme">
            <Select value={me.preferences.theme} onChange={(e) => save.mutate({ theme: e.target.value })}>
              <option value="dark">Dark (default)</option>
              <option value="light">Light</option>
            </Select>
          </Field>
        </div>
      </Panel>
      <Panel title="Feed preferences">
        <div className="space-y-4">
          <Field label="Default sort">
            <Select value={me.preferences.feedSort} onChange={(e) => save.mutate({ feedSort: e.target.value })}>
              <option value="newest">Newest</option>
              <option value="importance">Importance</option>
            </Select>
          </Field>
          <Checkbox
            checked={me.preferences.showDemo}
            onChange={(v) => save.mutate({ showDemo: v })}
            label="Show sample (demo) data"
            description="Only applies when demo mode is enabled on the server. Sample items are always labelled."
          />
          <Checkbox checked={me.preferences.hideReviewed} onChange={(v) => save.mutate({ hideReviewed: v })} label="Hide reviewed events by default" />
        </div>
      </Panel>
    </div>
  );
}

function Notifications({ me, info }: { me: MeDTO; info: Info | undefined }) {
  const save = usePrefsMutation();
  const { push } = useToasts();
  const [qh, setQh] = useState(me.preferences.quietHours);
  const [requested, setRequested] = useState<string | null>(null);
  const currentPermission = useSyncExternalStore(
    () => () => undefined,
    () => (typeof Notification !== "undefined" ? Notification.permission : "unsupported"),
    () => "default",
  );
  const permission = requested ?? currentPermission;
  const setPermission = setRequested;
  const test = useMutation({
    mutationFn: (channel: string) => apiFetch<{ ok: boolean; error?: string }>("/api/notifications/test", { method: "POST", body: { channel } }),
    onSuccess: (r, channel) => push({ title: r.ok ? `${channel}: test delivered` : `${channel}: test failed`, body: r.error, tone: r.ok ? "default" : "error" }),
    onError: (e) => push({ title: "Test failed", body: e instanceof ApiClientError ? e.message : String(e), tone: "error" }),
  });
  const configured = (c: string) => info?.integrations.find((i) => i.id === c)?.configured ?? false;
  const isOwner = me.user.role === "owner";
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel title="Channels" subtitle="In-app alerts are always on. Other channels deliver only when enabled here, selected in a rule/watchlist and configured on the server.">
        <ul className="space-y-3">
          {NOTIFICATION_CHANNELS.map((c) => (
            <li key={c} className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm">{CHANNEL_LABELS[c]}</p>
                <p className="text-2xs text-fg-3">
                  {c === "in_app" && "Delivered in the application."}
                  {c === "browser" && `Shown by your browser while the app is open in another tab. Permission: ${permission}.`}
                  {(c === "email" || c === "telegram" || c === "discord") && (configured(c) ? (isOwner ? "Configured on the server." : "Configured for the workspace owner only.") : "Not configured on the server (see Integrations).")}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {c === "browser" && permission === "default" && (
                  <Button size="xs" icon={<BellRing className="size-3" />} onClick={async () => setPermission(await Notification.requestPermission())}>
                    Allow
                  </Button>
                )}
                {(c === "email" || c === "telegram" || c === "discord") && isOwner && configured(c) && (
                  <Button size="xs" icon={<Send className="size-3" />} loading={test.isPending && test.variables === c} onClick={() => test.mutate(c)}>
                    Send test
                  </Button>
                )}
                <Toggle checked={c === "in_app" ? true : Boolean(me.preferences.channels[c])} disabled={c === "in_app"} onChange={(v) => save.mutate({ channels: { [c]: v } })} label={`Enable ${CHANNEL_LABELS[c]}`} />
              </div>
            </li>
          ))}
        </ul>
      </Panel>
      <Panel title="Quiet hours" subtitle="External deliveries are deferred until quiet hours end. In-app alerts still appear.">
        <div className="space-y-4">
          <Checkbox checked={qh.enabled} onChange={(v) => setQh({ ...qh, enabled: v })} label="Enable quiet hours" />
          <div className="flex gap-3">
            <Field label="Start">
              <Input type="time" value={qh.start} onChange={(e) => setQh({ ...qh, start: e.target.value })} className="font-mono" />
            </Field>
            <Field label="End">
              <Input type="time" value={qh.end} onChange={(e) => setQh({ ...qh, end: e.target.value })} className="font-mono" />
            </Field>
          </div>
          <Checkbox checked={qh.allowCritical} onChange={(v) => setQh({ ...qh, allowCritical: v })} label="Allow critical-priority alerts during quiet hours" />
          <p className="text-2xs text-fg-3">Uses your time zone: {me.preferences.timezone}.</p>
          <Button size="sm" variant="primary" loading={save.isPending} onClick={() => save.mutate({ quietHours: qh })}>
            Save quiet hours
          </Button>
        </div>
      </Panel>
    </div>
  );
}

function Integrations({ info, me }: { info: Info | undefined; me: MeDTO }) {
  const { push } = useToasts();
  const qc = useQueryClient();
  const reset = useMutation({
    mutationFn: () => apiFetch("/api/admin/demo", { method: "POST", body: {} }),
    onSuccess: () => {
      push({ title: "Demo restarted", body: "Sample data cleared; the scripted demo replays from the beginning." });
      void qc.invalidateQueries();
    },
    onError: (e) => push({ title: "Could not reset demo", body: (e as Error).message, tone: "error" }),
  });
  if (!info) return <Skeleton className="h-64" />;
  return (
    <div className="space-y-4">
      <Panel title="How credentials are configured">
        <p className="text-xs leading-relaxed text-fg-2">
          Credentials are read from server-side environment variables (<span className="font-mono">.env.local</span> locally, or your host&apos;s secret manager) and are never sent to the browser or
          stored in the database. Copy <span className="font-mono">.env.example</span>, fill in the values you have, and restart the server. This screen only shows whether each integration is configured.
        </p>
      </Panel>
      <div className="grid gap-4 lg:grid-cols-2">
        {info.integrations.map((i) => (
          <Panel
            key={i.id}
            title={i.name}
            actions={
              i.configured ? (
                <Badge tone="positive">
                  <CheckCircle2 className="size-3" /> configured
                </Badge>
              ) : (
                <Badge>
                  <CircleDashed className="size-3" /> not configured
                </Badge>
              )
            }
          >
            <p className="text-xs text-fg-2">{i.cost}</p>
            {i.model && i.configured && <p className="mt-1 font-mono text-2xs text-fg-3">model: {i.model}</p>}
            <p className="mt-2 text-2xs uppercase tracking-wider text-fg-3">Requires</p>
            <ul className="mt-1 space-y-0.5 font-mono text-2xs text-fg-2">
              {i.requires.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
            {i.id === "rss" && <p className="mt-2 text-2xs text-fg-3">SEC feeds: {i.secEdgarConfigured ? "User-Agent configured" : "waiting for SEC_USER_AGENT"}.</p>}
            {i.configured && i.id !== "rss" && <p className="mt-2 text-2xs text-fg-3">Configured does not mean verified. Check System Status for the last successful call.</p>}
          </Panel>
        ))}
      </div>
      <Panel title="Runtime">
        <dl className="grid gap-2 text-xs sm:grid-cols-3">
          <div>
            <dt className="text-fg-3">Database</dt>
            <dd className="font-mono">{info.database}</dd>
          </div>
          <div>
            <dt className="text-fg-3">Worker mode</dt>
            <dd className="font-mono">{info.workerMode}</dd>
          </div>
          <div>
            <dt className="text-fg-3">Demo mode</dt>
            <dd className="font-mono">{info.demoMode ? "on" : "off"}</dd>
          </div>
        </dl>
        {info.demoMode && me.user.role === "owner" && (
          <Button size="sm" className="mt-3" icon={<RotateCcw className="size-3.5" />} loading={reset.isPending} onClick={() => confirm("Delete all sample data and restart the demo script?") && reset.mutate()}>
            Restart demo
          </Button>
        )}
      </Panel>
      <Panel title="Processing limits & budgets" subtitle="Set via environment variables. When a budget is reached processing degrades gracefully (rules-only analysis, paused collection) and this is shown on System Status.">
        <dl className="grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
          {Object.entries(info.budgets).map(([k, v]) => (
            <div key={k} className="flex justify-between">
              <dt className="font-mono text-fg-3">{k}</dt>
              <dd className="font-mono">{v}</dd>
            </div>
          ))}
        </dl>
      </Panel>
    </div>
  );
}

function Scoring({ info }: { info: Info | undefined }) {
  if (!info) return <Skeleton className="h-64" />;
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Panel title="Importance weights" subtitle={`Scoring version ${info.scoring.version}`}>
        <ul className="space-y-1 text-xs">
          {Object.entries(info.scoring.importanceWeights).map(([k, v]) => (
            <li key={k} className="flex justify-between">
              <span className="text-fg-2">{IMPORTANCE_COMPONENT_LABELS[k as keyof typeof IMPORTANCE_COMPONENT_LABELS] ?? k}</span>
              <span className="font-mono">{Math.round(v * 100)}%</span>
            </li>
          ))}
        </ul>
      </Panel>
      <Panel title="Confidence weights" subtitle="Separate measure of evidence strength">
        <ul className="space-y-1 text-xs">
          {Object.entries(info.scoring.confidenceWeights).map(([k, v]) => (
            <li key={k} className="flex justify-between">
              <span className="text-fg-2">{CONFIDENCE_COMPONENT_LABELS[k as keyof typeof CONFIDENCE_COMPONENT_LABELS] ?? k}</span>
              <span className="font-mono">{Math.round(v * 100)}%</span>
            </li>
          ))}
        </ul>
      </Panel>
      <Panel title="Priority bands">
        <ul className="space-y-1 text-xs">
          {info.scoring.bands.map((b) => (
            <li key={b.id} className="flex justify-between">
              <span className="text-fg-2">{b.label}</span>
              <span className="font-mono">≥ {b.min}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-2xs text-fg-3">
          Unknown components policy: <span className="font-mono">{info.scoring.unknownPolicy.policy}</span>. An 85 means “high research priority”, not an 85% probability of a move or a profitable trade. Weights and bands
          are configured in <span className="font-mono">src/config/scoring.ts</span> (see docs/SCORING.md).
        </p>
      </Panel>
    </div>
  );
}

function DataRetention({ info }: { info: Info | undefined }) {
  if (!info) return <Skeleton className="h-40" />;
  return (
    <Panel title="Data retention" subtitle="Third-party content is stored separately from event metadata so it can be purged without losing the audit trail.">
      <ul className="space-y-2 text-xs text-fg-2">
        <li>
          X post text is kept for <span className="font-mono">{info.retention.xContentDays}</span> days (X_CONTENT_RETENTION_DAYS), then removed; deleted or unavailable posts are purged when detected
          {info.retention.xComplianceRefreshHours > 0
            ? ` (availability first re-checked after ${info.retention.xComplianceRefreshHours}h, then each time a post's age doubles, using at most ${info.retention.xComplianceMaxReadsPerDay} reads per day)`
            : " (availability re-checks are disabled)"}
          .
        </li>
        <li>
          Official feed text is kept for <span className="font-mono">{info.retention.rssContentDays}</span> days (RSS_CONTENT_RETENTION_DAYS).
        </li>
        <li>Event metadata, scores, audit trails and your notes are kept until deleted. Sample data can be cleared with “Restart demo”.</li>
        <li>Do not republish collected third-party content commercially without confirming redistribution rights with the provider.</li>
      </ul>
    </Panel>
  );
}

function LocalModeNotice() {
  return (
    <Panel title="Sign-in is off on this computer">
      <ul className="space-y-1.5 text-xs text-fg-2">
        <li>
          <span className="font-mono">LOCAL_NO_LOGIN=true</span> in <span className="font-mono">.env.local</span> opens the app as the workspace owner without a password.
        </li>
        <li>It only works with npm run dev, which listens on this computer only, and only for pages opened at localhost. Other devices on your network cannot reach the app.</li>
        <li>
          To require sign-in again, remove <span className="font-mono">LOCAL_NO_LOGIN</span> from <span className="font-mono">.env.local</span> and restart the app.
        </li>
      </ul>
    </Panel>
  );
}

function Security() {
  const { push } = useToasts();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [deletePw, setDeletePw] = useState("");
  const change = useMutation({
    mutationFn: () => apiFetch("/api/auth/password", { method: "POST", body: { currentPassword: current, newPassword: next } }),
    onSuccess: () => {
      setCurrent("");
      setNext("");
      push({ title: "Password changed", body: "All other sessions were signed out." });
    },
    onError: (e) => push({ title: "Could not change password", body: (e as Error).message, tone: "error" }),
  });
  const signOutAll = useMutation({
    mutationFn: () => apiFetch("/api/auth/sessions", { method: "DELETE" }),
    onSuccess: () => hardNavigate("/login"),
  });
  const del = useMutation({
    mutationFn: () => apiFetch("/api/auth/account", { method: "POST", body: { password: deletePw } }),
    onSuccess: () => hardNavigate("/login"),
    onError: (e) => push({ title: "Could not delete account", body: (e as Error).message, tone: "error" }),
  });
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel title="Change password">
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            change.mutate();
          }}
        >
          <Field label="Current password">
            <Input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required />
          </Field>
          <Field label="New password" hint="At least 10 characters.">
            <Input type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" minLength={10} required />
          </Field>
          <Button type="submit" size="sm" variant="primary" loading={change.isPending}>
            Change password
          </Button>
        </form>
      </Panel>
      <div className="space-y-4">
        <Panel title="Sessions">
          <p className="mb-3 text-xs text-fg-2">Sessions are stored as hashed tokens in httpOnly cookies and expire automatically.</p>
          <Button size="sm" onClick={() => signOutAll.mutate()} loading={signOutAll.isPending}>
            Sign out of all sessions
          </Button>
        </Panel>
        <Panel title="Privacy">
          <ul className="space-y-1 text-xs text-fg-2">
            <li>We store your email, display name, a password hash and your preferences — nothing else about you.</li>
            <li>No IP addresses are stored with sessions. Logs redact credentials.</li>
            <li>Your watchlists, notes, alerts and feedback are private to your account.</li>
          </ul>
        </Panel>
        <Panel title="Delete account">
          <p className="mb-2 text-xs text-fg-2">Permanently deletes your account, watchlists, notes, alerts and feedback.</p>
          <div className="flex gap-2">
            <Input type="password" placeholder="Confirm with password" value={deletePw} onChange={(e) => setDeletePw(e.target.value)} autoComplete="current-password" />
            <Button variant="danger" disabled={!deletePw} loading={del.isPending} onClick={() => confirm("Permanently delete your account?") && del.mutate()}>
              Delete
            </Button>
          </div>
        </Panel>
      </div>
    </div>
  );
}

function Account({ me }: { me: MeDTO }) {
  const save = usePrefsMutation();
  const [name, setName] = useState(me.user.displayName);
  return (
    <Panel title="Account">
      <div className="max-w-md space-y-4">
        <Field label="Display name">
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
        </Field>
        <Button size="sm" variant="primary" onClick={() => save.mutate({ displayName: name })} loading={save.isPending}>
          Save
        </Button>
        <dl className="grid grid-cols-2 gap-2 border-t border-line-subtle pt-3 text-xs">
          <dt className="text-fg-3">Email</dt>
          <dd>{me.user.email}</dd>
          <dt className="text-fg-3">Role</dt>
          <dd>{me.user.role === "owner" ? "Workspace owner" : "Member"}</dd>
          <dt className="text-fg-3">Plan</dt>
          <dd>
            {me.user.plan} <span className="text-fg-3">(no billing is connected; limits are enforced on the server)</span>
          </dd>
        </dl>
      </div>
    </Panel>
  );
}

function SettingsView() {
  const me = useMe();
  const params = useSearchParams();
  const initial = (params.get("tab") as Tab | null) ?? "preferences";
  const [tab, setTab] = useState<Tab>(initial);
  const info = useQuery({ queryKey: ["settings-info"], queryFn: () => apiFetch<Info>("/api/settings/info") });
  if (!me) return <Skeleton className="h-64" />;
  return (
    <div className="space-y-4">
      <PageHeader title="Settings" description="Preferences, notification channels, integrations, scoring parameters, data retention and security." />
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "preferences", label: "Preferences" },
          { id: "notifications", label: "Notifications" },
          { id: "integrations", label: "Integrations" },
          { id: "scoring", label: "Importance thresholds" },
          { id: "data", label: "Data retention" },
          { id: "account", label: "Account" },
          { id: "security", label: "Privacy & security" },
        ]}
      />
      {tab === "preferences" && <Preferences me={me} />}
      {tab === "notifications" && <Notifications me={me} info={info.data} />}
      {tab === "integrations" && <Integrations info={info.data} me={me} />}
      {tab === "scoring" && <Scoring info={info.data} />}
      {tab === "data" && <DataRetention info={info.data} />}
      {tab === "account" && <Account me={me} />}
      {tab === "security" && (me?.localMode ? <LocalModeNotice /> : <Security />)}
    </div>
  );
}

export default function SettingsPage() {
  return (
    <Suspense fallback={<Skeleton className="h-64" />}>
      <SettingsView />
    </Suspense>
  );
}
