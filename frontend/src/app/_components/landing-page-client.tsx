"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Button } from "../../components/ui/button";
import { Badge } from "../../components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { Alert, AlertDescription } from "../../components/ui/alert";
import { api } from "../../lib/api";
import { useAuthStatus } from "../../hooks/use-auth-status";

const DOCS_URL = "https://github.com/najahiiii/gh-weebhooks#readme";

const featureCards = [
  {
    title: "GitHub → Telegram bridge",
    description: "Capture repository activity and ship it straight into Telegram chats with minimal wiring.",
    badge: "Bridge"
  },
  {
    title: "Human-friendly payloads",
    description: "Markdown-safe templates, auto commit splitting, and secret masking keep notifications readable.",
    badge: "Delivery"
  },
  {
    title: "Ops ready",
    description: "Rotate tokens, drop pending Telegram updates, inspect webhooks, and audit event logs from one dashboard.",
    badge: "Operations"
  }
];

const architecture = [
  {
    title: "Express backend",
    body: "Handles Telegram/GitHub webhooks, manages sessions, and persists bots, destinations, and delivery logs in SQLite.",
    href: "https://github.com/najahiiii/gh-weebhooks/tree/master/backend"
  },
  {
    title: "Next.js dashboard",
    body: "Client-side views for managing bots, destinations, subscriptions, and analytics with toast feedback.",
    href: "https://github.com/najahiiii/gh-weebhooks/tree/master/frontend"
  },
  {
    title: "SQLite store",
    body: "Single-file database ideal for self-hosting; secrets and delivery logs live locally for quick audits.",
    href: null
  }
];

const quickLinks = [
  { method: "GET", label: "Health check", path: "/healthz" },
  { method: "POST", label: "GitHub webhook", path: "/wh/{hook_id}" },
  { method: "POST", label: "Telegram webhook", path: "/tg/{bot_id}/{token}" },
  { method: "GET", label: "Stats API", path: "/api/stats" },
  { method: "GET", label: "Events API", path: "/api/events" }
];

const setupSteps = [
  "Copy `.env.example` files to `.env` (backend) and `.env.local` (frontend), then fill secrets.",
  "Run `npm install && npm run dev` in both backend/ and frontend/.",
  "Add a Telegram bot token in the dashboard (optional: drop pending updates to clean queues).",
  "Register destinations (chat IDs or topics) and create subscriptions per repository.",
  "Paste the generated GitHub webhook URL + secret into repository settings and you're live."
];

export default function LandingPage() {
  const year = useMemo(() => new Date().getFullYear(), []);
  const { status: authStatus, user, error: authError, refresh } = useAuthStatus();
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);

  const isAuthenticated = authStatus === "authenticated";
  const isCheckingAuth = authStatus === "loading";
  const primaryCtaHref = isAuthenticated ? "/dashboard" : "/login";
  const primaryCtaLabel = isAuthenticated ? "Open dashboard" : "Sign in with Telegram";
  const secondaryCta = isAuthenticated
    ? { href: "/stats", label: "View stats", external: false as const }
    : { href: DOCS_URL, label: "Project documentation", external: true as const };
  const feedbackMessage = signOutError ?? authError;
  const signedInLabel = user ? user.username ?? user.telegramUserId : "";

  const handleSignOut = async () => {
    setSigningOut(true);
    setSignOutError(null);
    try {
      await api.auth.logout();
    } catch (err) {
      setSignOutError(err instanceof Error ? err.message : "Failed to sign out");
    } finally {
      await refresh();
      setSigningOut(false);
    }
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-slate-950 text-slate-100">
      <div className="absolute inset-0 z-0 bg-[radial-gradient(circle_at_20%_15%,rgba(56,189,248,0.45),rgba(15,23,42,0.96)60%,rgba(2,6,23,1))]" />
      <div className="absolute inset-x-0 top-40 z-0 h-64 bg-[radial-gradient(circle_at_50%_0%,rgba(125,211,252,0.25),rgba(2,6,23,0))] blur-3xl" />
      <div className="relative z-10 flex min-h-screen flex-col">
        <header className="flex items-center justify-between px-6 py-5 lg:px-16">
          <Link href="/" className="flex items-center gap-3 text-lg font-semibold tracking-tight">
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-sky-500/20 text-sky-300 shadow-inner shadow-sky-500/30">
              ↔
            </span>
            <span className="hidden sm:inline">GitHub → Telegram</span>
            <span className="sm:hidden">GH → TG</span>
          </Link>
          <nav className="flex flex-wrap items-center gap-3 text-sm text-slate-300">
            {isCheckingAuth ? (
              <span className="text-xs text-slate-500">Checking session…</span>
            ) : (
              !isAuthenticated && (
                <Link href="/login" className="transition hover:text-sky-200">
                  Login
                </Link>
              )
            )}
            <a
              href="https://github.com/najahiiii/gh-weebhooks"
              className="transition hover:text-sky-200"
              target="_blank"
              rel="noopener noreferrer"
            >
              GitHub
            </a>
            <Link
              href="/dashboard"
              className="hidden rounded-full border border-slate-800/70 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-200 transition hover:border-sky-500/50 hover:text-sky-200 md:inline-flex"
            >
              Dashboard
            </Link>
            {isAuthenticated && (
              <Button
                variant="ghost"
                size="sm"
                className="text-xs uppercase tracking-wide text-slate-400 hover:text-slate-100"
                onClick={handleSignOut}
                disabled={signingOut}
              >
                {signingOut ? "Signing out…" : "Sign out"}
              </Button>
            )}
          </nav>
        </header>

        <main className="flex-1 px-6 pb-24 lg:px-16">
          <section className="mx-auto grid w-full max-w-6xl gap-12 py-16 min-h-[calc(100vh-140px)] lg:grid-cols-[1.2fr,0.8fr] lg:items-center">
            <div className="space-y-6">
              <Badge variant="sky" className="w-fit">Realtime bridge</Badge>
              <h1 className="text-4xl font-bold tracking-tight text-slate-50 sm:text-5xl lg:text-6xl">
                Keep GitHub activity flowing into Telegram.
              </h1>
              <p className="max-w-2xl text-base text-slate-300 sm:text-lg">
                Run one service that receives GitHub webhooks, forwards them to Telegram, and gives you the tooling to manage bots,
                destinations, subscriptions, and delivery logs without SSHing into a box.
              </p>
              {isAuthenticated && signedInLabel && (
                <p className="text-sm text-slate-400">
                  Signed in as <span className="font-semibold text-slate-200">{signedInLabel}</span>. Continue to the dashboard or explore
                  stats below.
                </p>
              )}
              <div className="flex flex-wrap gap-3">
                <Button size="lg" className="px-6" asChild>
                  <Link href={primaryCtaHref}>{primaryCtaLabel}</Link>
                </Button>
                {secondaryCta.external ? (
                  <Button variant="secondary" size="lg" className="px-6" asChild>
                    <a href={secondaryCta.href} target="_blank" rel="noopener noreferrer">
                      {secondaryCta.label}
                    </a>
                  </Button>
                ) : (
                  <Button variant="secondary" size="lg" className="px-6" asChild>
                    <Link href={secondaryCta.href}>{secondaryCta.label}</Link>
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="lg"
                  className="px-6 text-slate-200 hover:text-sky-300"
                  onClick={() => {
                    const target = document.querySelector("#features");
                    if (target) {
                      target.scrollIntoView({ behavior: "smooth", block: "start" });
                    }
                  }}
                >
                  Explore features
                </Button>
              </div>
              {feedbackMessage && (
                <Alert variant="destructive" className="max-w-lg">
                  <AlertDescription>{feedbackMessage}</AlertDescription>
                </Alert>
              )}
            </div>

            <Card className="border-slate-800/60 bg-slate-900/70 shadow-xl shadow-sky-900/20">
              <CardHeader>
                <Badge variant="emerald" className="w-fit">Preview</Badge>
                <CardTitle className="text-2xl">Sample notification</CardTitle>
                <CardDescription>Readable HTML preview that mirrors what Telegram renders.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-slate-300">
                <div className="rounded-xl border border-slate-800/70 bg-slate-950/60 p-4">
                  <p className="text-slate-200"><span className="font-semibold text-sky-200">Push</span> to <code>main</code></p>
                  <p className="text-xs uppercase tracking-wide text-slate-500">Commits</p>
                  <ul className="space-y-1 border-l border-slate-700 pl-3 text-xs">
                    <li><code className="text-slate-400">ab13e91</code> Fix race condition when parsing payloads</li>
                    <li><code className="text-slate-400">d8f93aa</code> Align FastAPI markdown renderer with Node port</li>
                    <li><code className="text-slate-400">fe9012b</code> Add regression coverage for webhook summariser</li>
                  </ul>
                </div>
                <div className="flex flex-wrap gap-2 text-[11px] uppercase tracking-wide text-slate-400">
                  <span className="rounded-full bg-slate-800/60 px-3 py-1">Markdown-safe</span>
                  <span className="rounded-full bg-slate-800/60 px-3 py-1">Auto split</span>
                  <span className="rounded-full bg-slate-800/60 px-3 py-1">Topics ready</span>
                </div>
              </CardContent>
            </Card>
          </section>

          <section id="features" className="mx-auto w-full max-w-6xl space-y-6 pt-24">
            <div className="flex flex-col gap-2 text-center">
              <h2 className="text-3xl font-semibold text-slate-50">What you get</h2>
              <p className="text-sm text-slate-400">Focused features that cover the full lifecycle of managing GitHub → Telegram webhooks.</p>
            </div>
            <div className="grid gap-6 md:grid-cols-3">
              {featureCards.map((feature) => (
                <Card key={feature.title} className="border-slate-800/60 bg-slate-900/70">
                  <CardHeader>
                    <Badge variant="sky" className="w-fit">{feature.badge}</Badge>
                    <CardTitle>{feature.title}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-slate-300">{feature.description}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>

          <section className="mx-auto grid w-full max-w-6xl gap-6 pt-24 lg:grid-cols-3">
            {architecture.map((item) => (
              <Card key={item.title} className="border-slate-800/60 bg-slate-900/70">
                <CardHeader>
                  <CardTitle>{item.title}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm text-slate-300">
                  <p>{item.body}</p>
                  {item.href ? (
                    <Button variant="ghost" size="sm" className="text-xs uppercase tracking-wide text-sky-300 hover:text-sky-200" asChild>
                      <a href={item.href} target="_blank" rel="noopener noreferrer">
                        View {item.href.includes("frontend") ? "frontend" : "backend"}
                      </a>
                    </Button>
                  ) : null}
                </CardContent>
              </Card>
            ))}
          </section>

          <section className="mx-auto grid w-full max-w-6xl gap-6 pt-24 md:grid-cols-[1.2fr,0.8fr]">
            <Card className="border-slate-800/60 bg-slate-900/70">
              <CardHeader>
                <CardTitle>Quick start</CardTitle>
                <CardDescription>Everything you need to self-host in minutes.</CardDescription>
              </CardHeader>
              <CardContent>
                <ol className="space-y-3 text-sm text-slate-300">
                  {setupSteps.map((step, index) => (
                    <li key={step} className="flex items-start gap-3">
                      <span className="mt-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-sky-500/10 text-xs font-semibold text-sky-300">
                        {index + 1}
                      </span>
                      <span>{step}</span>
                    </li>
                  ))}
                </ol>
              </CardContent>
            </Card>
            <Card className="border-slate-800/60 bg-slate-900/70">
              <CardHeader>
                <CardTitle>Key endpoints</CardTitle>
                <CardDescription>Bookmark these routes when wiring GitHub and Telegram.</CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="space-y-3 text-sm text-slate-300">
                  {quickLinks.map((endpoint) => (
                    <li key={endpoint.path} className="rounded-2xl border border-slate-800/70 bg-slate-950/60 p-3">
                      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-sky-300">
                        <span>{endpoint.method}</span>
                        <span className="text-slate-500">•</span>
                        <code className="text-slate-200">{endpoint.path}</code>
                      </div>
                      <p className="text-xs text-slate-500">{endpoint.label}</p>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </section>
        </main>

        <footer className="border-t border-slate-800/60 bg-slate-950/90 py-6">
          <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-3 px-6 text-xs text-slate-500 sm:flex-row lg:px-16">
            <p className="text-center sm:text-left">
              &copy; {year}{" "}
              <a
                href="https://github.com/najahiiii/gh-weebhooks"
                className="underline-offset-2 hover:text-slate-200 hover:underline"
                target="_blank"
                rel="noopener noreferrer"
              >
                gh-weebhooks
              </a>
            </p>
            <div className="flex items-center gap-3 text-xs uppercase tracking-wide text-slate-400">
              <a href="/dashboard" className="transition hover:text-sky-300">
                Dashboard
              </a>
              <span className="text-slate-700">•</span>
              <a href="/stats" className="transition hover:text-sky-300">
                Stats
              </a>
              <span className="text-slate-700">•</span>
              <a href={DOCS_URL} target="_blank" rel="noopener noreferrer" className="transition hover:text-sky-300">
                Documentation
              </a>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}
