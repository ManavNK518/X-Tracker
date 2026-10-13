"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Activity,
  Archive,
  Bell,
  Eye,
  Gauge,
  LayoutDashboard,
  LogOut,
  Menu,
  NotebookPen,
  Radio,
  Rss,
  Search,
  Settings,
  X,
} from "lucide-react";
import { PRODUCT } from "@/config/product";
import { apiFetch, hardNavigate } from "@/lib/client/api";
import { cn } from "@/lib/client/cn";
import { useMe, useStream } from "@/components/providers/app-providers";
import { StatusDot } from "@/components/ui/badges";
import { Clock } from "@/components/ui/time";
import { Kbd } from "@/components/ui/primitives";

const NAV = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/feed", label: "Live Feed", icon: Radio },
  { href: "/history", label: "Historical Events", icon: Archive },
  { href: "/watchlists", label: "Watchlists", icon: Eye },
  { href: "/research", label: "Research", icon: NotebookPen },
  { href: "/alerts", label: "Alerts", icon: Bell },
  { href: "/sources", label: "Sources", icon: Rss },
  { href: "/status", label: "System Status", icon: Gauge },
  { href: "/settings", label: "Settings", icon: Settings },
];

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

export function DataModeIndicator({ compact }: { compact?: boolean }) {
  const { status, connection } = useStream();
  const mode = connection?.mode;
  let label = "Connecting";
  let dot: "ok" | "warn" | "error" | "off" | "info" = "off";
  let title = "Establishing the live update stream…";
  if (status === "offline") {
    label = "Offline";
    dot = "error";
    title = "The live update stream is disconnected. Data shown may be out of date.";
  } else if (mode === "live") {
    label = "Live";
    dot = "ok";
    title = "Connected to live sources. Shown items come from configured providers.";
  } else if (mode === "live+demo") {
    label = "Live + Demo";
    dot = "warn";
    title = "Live sources connected. Demo mode is also on: sample items are labelled SAMPLE DATA.";
  } else if (mode === "demo") {
    label = "Demo";
    dot = "warn";
    title = "Demo mode only: all items are fictional SAMPLE DATA.";
  } else if (mode === "awaiting_configuration") {
    label = "Awaiting setup";
    dot = "off";
    title = "No live source is configured.";
  } else if (mode === "disconnected") {
    label = "Disconnected";
    dot = "error";
    title = "Live sources are configured but not currently delivering data. Check System Status.";
  }
  const reconnecting = status === "reconnecting" || status === "connecting";
  return (
    <Link
      href="/status"
      title={title}
      className="inline-flex items-center gap-1.5 rounded-md border border-line px-2 py-1 text-2xs font-semibold uppercase tracking-wider text-fg-2 hover:bg-hover"
      data-testid="data-mode"
      data-mode={mode ?? "unknown"}
    >
      <StatusDot status={dot} pulse={dot === "ok" && !reconnecting} />
      {label}
      {!compact && reconnecting && status !== "connecting" && <span className="font-normal normal-case tracking-normal text-fg-3">· reconnecting</span>}
    </Link>
  );
}

function GlobalSearch() {
  const router = useRouter();
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (e.key === "/" && !["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) {
        e.preventDefault();
        ref.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <form
      role="search"
      className="relative hidden w-full max-w-md md:block"
      onSubmit={(e) => {
        e.preventDefault();
        const q = ref.current?.value.trim();
        if (q) router.push(`/feed?q=${encodeURIComponent(q)}`);
      }}
    >
      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-fg-3" aria-hidden />
      <input
        ref={ref}
        type="search"
        aria-label="Search events, tickers and event IDs"
        placeholder="Search events, tickers, EV- IDs"
        className="h-8 w-full rounded-md border border-line bg-surface pl-8 pr-10 text-sm placeholder:text-fg-3 focus:border-accent-line focus:outline-none"
      />
      <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2">
        <Kbd>/</Kbd>
      </span>
    </form>
  );
}

function UserMenu() {
  const me = useMe();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);
  const initials = (me?.user.displayName ?? "?").split(/\s+/).map((p) => p[0]).join("").slice(0, 2).toUpperCase();
  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex size-7 items-center justify-center rounded-full border border-line bg-elevated text-2xs font-semibold text-fg-2 hover:text-fg"
        aria-label="Account menu"
        aria-expanded={open}
      >
        {initials}
      </button>
      {open && (
        <div className="absolute right-0 top-9 z-40 w-56 rounded-md border border-line bg-elevated py-1 shadow-xl">
          <div className="border-b border-line-subtle px-3 py-2">
            <p className="truncate text-sm font-medium">{me?.user.displayName}</p>
            <p className="truncate text-2xs text-fg-3">{me?.user.email}</p>
            <p className="mt-1 text-2xs uppercase tracking-wider text-fg-3">{me?.user.role === "owner" ? "Workspace owner" : "Member"} · {me?.user.plan} plan</p>
          </div>
          <Link href="/settings" className="flex items-center gap-2 px-3 py-1.5 text-sm text-fg-2 hover:bg-hover hover:text-fg" onClick={() => setOpen(false)}>
            <Settings className="size-3.5" /> Settings
          </Link>
          {me?.localMode ? (
            <p className="px-3 py-1.5 text-2xs text-fg-3">Sign-in is off on this computer.</p>
          ) : (
            <button
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-fg-2 hover:bg-hover hover:text-fg"
              onClick={async () => {
                await apiFetch("/api/auth/logout", { method: "POST", body: {} }).catch(() => undefined);
                hardNavigate("/login");
              }}
            >
              <LogOut className="size-3.5" /> Sign out
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const me = useMe();
  return (
    <nav aria-label="Main" className="flex flex-col gap-0.5 px-2">
      {NAV.map((item) => {
        const active = isActive(pathname, item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "group relative flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors",
              active ? "bg-accent-soft text-fg" : "text-fg-2 hover:bg-hover hover:text-fg",
            )}
          >
            {active && <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-accent" aria-hidden />}
            <Icon className={cn("size-4", active ? "text-accent" : "text-fg-3 group-hover:text-fg-2")} aria-hidden />
            <span className="flex-1">{item.label}</span>
            {item.href === "/alerts" && (me?.unreadNotifications ?? 0) > 0 && (
              <span className="rounded bg-accent-soft px-1 font-mono text-2xs text-accent">{me!.unreadNotifications}</span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

function Banners() {
  const { connection, status } = useStream();
  const pathname = usePathname();
  const banners: { tone: "warn" | "info" | "error"; text: ReactNode; key: string }[] = [];
  if (connection?.demoMode) {
    banners.push({
      key: "demo",
      tone: "warn",
      text: (
        <>
          <strong className="font-semibold">Demo mode is on.</strong> Items labelled <span className="font-mono">SAMPLE DATA</span> are fictional and exist only to demonstrate the interface. They are never sent to external notification channels.
        </>
      ),
    });
  }
  if (connection && !connection.workerAlive) {
    banners.push({ key: "worker", tone: "error", text: "The background worker is not running, so collection and analysis are paused. Shown data may be stale. See System Status." });
  }
  if (connection?.mode === "awaiting_configuration" && pathname !== "/settings") {
    banners.push({
      key: "setup",
      tone: "info",
      text: (
        <>
          No live data source is configured. Official RSS feeds can be enabled with <span className="font-mono">RSS_ENABLED=true</span>; X collection needs <span className="font-mono">X_BEARER_TOKEN</span>.{" "}
          <Link href="/settings?tab=integrations" className="underline">
            Integration setup
          </Link>
        </>
      ),
    });
  }
  if (status === "offline") banners.push({ key: "offline", tone: "error", text: "Live updates are disconnected. Retrying in the background; reload to reconnect now." });
  if (banners.length === 0) return null;
  return (
    <div className="space-y-px">
      {banners.map((b) => (
        <div
          key={b.key}
          role="status"
          className={cn(
            "px-4 py-1.5 text-xs md:px-6",
            b.tone === "warn" && "bg-warning-soft text-warning",
            b.tone === "info" && "bg-info-soft text-info",
            b.tone === "error" && "bg-negative-soft text-negative",
          )}
        >
          {b.text}
        </div>
      ))}
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const [drawer, setDrawer] = useState(false);
  const me = useMe();
  const pathname = usePathname();
  // Close the mobile drawer on any navigation (including back/forward).
  const [drawerPath, setDrawerPath] = useState(pathname);
  if (drawerPath !== pathname) {
    setDrawerPath(pathname);
    if (drawer) setDrawer(false);
  }
  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-56 shrink-0 flex-col border-r border-line bg-surface lg:flex">
        <Brand />
        <div className="flex-1 overflow-y-auto py-2">
          <SidebarNav />
        </div>
        <SidebarFooter />
      </aside>

      {drawer && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <div className="absolute inset-0 bg-black/60" onClick={() => setDrawer(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-64 flex-col border-r border-line bg-surface">
            <div className="flex items-center justify-between pr-2">
              <Brand />
              <button className="p-2 text-fg-3 hover:text-fg" aria-label="Close navigation" onClick={() => setDrawer(false)}>
                <X className="size-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto py-2">
              <SidebarNav onNavigate={() => setDrawer(false)} />
            </div>
            <SidebarFooter />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 border-b border-line bg-bg/95 backdrop-blur">
          <div className="flex h-12 items-center gap-3 px-3 md:px-6">
            <button className="rounded-md p-1.5 text-fg-2 hover:bg-hover lg:hidden" aria-label="Open navigation" onClick={() => setDrawer(true)}>
              <Menu className="size-4" />
            </button>
            <span className="text-sm font-semibold tracking-tight lg:hidden">{PRODUCT.shortName}</span>
            <GlobalSearch />
            <div className="ml-auto flex items-center gap-2 md:gap-3">
              <DataModeIndicator />
              <span className="hidden sm:inline">
                <Clock />
              </span>
              <Link href="/alerts" className="relative rounded-md p-1.5 text-fg-2 hover:bg-hover hover:text-fg" aria-label={`Alerts${me?.unreadNotifications ? ` (${me.unreadNotifications} unread)` : ""}`}>
                <Bell className="size-4" />
                {(me?.unreadNotifications ?? 0) > 0 && (
                  <span className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-accent px-1 text-center font-mono text-[9px] font-bold leading-4 text-bg">
                    {me!.unreadNotifications > 99 ? "99+" : me!.unreadNotifications}
                  </span>
                )}
              </Link>
              <UserMenu />
            </div>
          </div>
          <Banners />
        </header>
        <main className="flex-1 px-3 py-4 md:px-6 md:py-5">{children}</main>
        <footer className="border-t border-line-subtle px-4 py-3 text-2xs text-fg-3 md:px-6">{PRODUCT.disclaimer}</footer>
      </div>
    </div>
  );
}

function Brand() {
  return (
    <Link href="/" className="flex h-12 items-center gap-2 px-4">
      <span className="flex size-6 items-center justify-center rounded bg-accent-soft text-accent">
        <Activity className="size-3.5" aria-hidden />
      </span>
      <span className="text-sm font-semibold tracking-tight">{PRODUCT.name}</span>
    </Link>
  );
}

function SidebarFooter() {
  const { connection } = useStream();
  return (
    <div className="border-t border-line-subtle px-4 py-3">
      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-fg-3">Sources</p>
      <ul className="space-y-1">
        {(connection?.providers ?? []).map((p) => (
          <li key={p.provider} className="flex items-center justify-between gap-2 text-2xs">
            <span className="flex items-center gap-1.5 text-fg-2">
              <StatusDot
                status={
                  p.status === "connected" ? "ok" : p.status === "degraded" || p.status === "starting" || p.status === "stale" ? "warn" : p.status === "error" || p.status === "worker_offline" ? "error" : "off"
                }
              />
              {p.label}
            </span>
            <span className="font-mono text-fg-3">{p.status.replace(/_/g, " ")}</span>
          </li>
        ))}
        {!connection && <li className="text-2xs text-fg-3">Checking…</li>}
      </ul>
    </div>
  );
}
