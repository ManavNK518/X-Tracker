"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Activity } from "lucide-react";
import { PRODUCT } from "@/config/product";
import { apiFetch, ApiClientError, hardNavigate } from "@/lib/client/api";
import { Button, Field, Input } from "@/components/ui/primitives";

function LoginForm() {
  const params = useSearchParams();
  const [setup, setSetup] = useState<{ hasUsers: boolean; signupOpen: boolean } | null>(null);
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiFetch<{ hasUsers: boolean; signupOpen: boolean }>("/api/auth/setup")
      .then((s) => {
        setSetup(s);
        if (!s.hasUsers) setMode("signup");
      })
      .catch(() => {
        setSetup({ hasUsers: true, signupOpen: false });
        setError("Could not reach the server to check account setup. Check that the app and its database are running, then reload.");
      });
  }, []);

  const next = params.get("next");
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === "signup") {
        await apiFetch("/api/auth/signup", { method: "POST", body: { email, password, displayName } });
      } else {
        await apiFetch("/api/auth/login", { method: "POST", body: { email, password } });
      }
      hardNavigate(safeNext);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Unable to sign in. Please try again.");
      setBusy(false);
    }
  }

  const firstRun = setup && !setup.hasUsers;
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-2">
          <span className="flex size-7 items-center justify-center rounded bg-accent-soft text-accent">
            <Activity className="size-4" aria-hidden />
          </span>
          <div>
            <p className="text-sm font-semibold tracking-tight">{PRODUCT.name}</p>
            <p className="text-2xs text-fg-3">{PRODUCT.tagline}</p>
          </div>
        </div>
        <form onSubmit={submit} className="space-y-4 rounded-lg border border-line bg-surface p-5">
          <div>
            <h1 className="text-base font-semibold">{mode === "signup" ? (firstRun ? "Create the owner account" : "Create an account") : "Sign in"}</h1>
            {firstRun && (
              <p className="mt-1 text-xs text-fg-3">This is the first account on this installation. It becomes the workspace owner and can manage sources and integrations.</p>
            )}
          </div>
          {mode === "signup" && (
            <Field label="Display name">
              <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} required maxLength={80} autoComplete="name" />
            </Field>
          )}
          <Field label="Email">
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
          </Field>
          <Field label="Password" hint={mode === "signup" ? "At least 10 characters." : undefined}>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={mode === "signup" ? 10 : 1}
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
            />
          </Field>
          {error && (
            <p role="alert" className="rounded border border-negative/30 bg-negative-soft px-2.5 py-1.5 text-xs text-negative">
              {error}
            </p>
          )}
          <Button type="submit" variant="primary" className="w-full" loading={busy} disabled={!setup}>
            {mode === "signup" ? "Create account" : "Sign in"}
          </Button>
          {setup?.hasUsers && setup.signupOpen && (
            <button type="button" className="w-full text-center text-xs text-fg-3 hover:text-fg" onClick={() => setMode(mode === "login" ? "signup" : "login")}>
              {mode === "login" ? "Need an account? Create one" : "Have an account? Sign in"}
            </button>
          )}
        </form>
        <p className="mt-4 text-center text-2xs leading-relaxed text-fg-3">{PRODUCT.disclaimer}</p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
