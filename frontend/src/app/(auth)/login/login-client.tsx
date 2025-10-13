"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { api, type TelegramAuthPayload } from "../../../lib/api";
import { Button } from "../../../components/ui/button";
import { Badge } from "../../../components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";
import { Alert, AlertDescription } from "../../../components/ui/alert";
import { useAuthStatus } from "../../../hooks/use-auth-status";

const TELEGRAM_BOT = process.env.NEXT_PUBLIC_TELEGRAM_LOGIN_BOT || "";

declare global {
  interface Window {
    onTelegramAuth?: (user: TelegramAuthPayload) => void;
  }
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-slate-950">
          <div className="flex items-center gap-3 rounded-full border border-slate-800/60 bg-slate-900/60 px-6 py-3 text-sm text-slate-300 shadow-inner shadow-black/40">
            <span className="h-3 w-3 animate-ping rounded-full bg-sky-400" />
            Loading login…
          </div>
        </div>
      }
    >
      <LoginPageContent />
    </Suspense>
  );
}

function LoginPageContent() {
  const router = useRouter();
  const params = useSearchParams();
  const { status: authStatus, error: authStatusError } = useAuthStatus();
  const [error, setError] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const widgetRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (authStatus === "authenticated" || authStatus === "loading") {
      return;
    }
    window.onTelegramAuth = async (user: TelegramAuthPayload) => {
      setProcessing(true);
      setError(null);
      try {
        await api.auth.verifyTelegram(user);
        const nextPath = params.get("next") || "/dashboard";
        router.replace(nextPath);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Login failed");
      } finally {
        setProcessing(false);
      }
    };
    return () => {
      delete window.onTelegramAuth;
    };
  }, [authStatus, params, router]);

  useEffect(() => {
    if (authStatus === "authenticated" || authStatus === "loading" || !TELEGRAM_BOT || !widgetRef.current) {
      return;
    }
    widgetRef.current.innerHTML = "";
    const script = document.createElement("script");
    script.async = true;
    script.src = "https://telegram.org/js/telegram-widget.js?22";
    script.setAttribute("data-telegram-login", TELEGRAM_BOT);
    script.setAttribute("data-size", "large");
    script.setAttribute("data-request-access", "write");
    script.setAttribute("data-onauth", "onTelegramAuth(user)");
    widgetRef.current.appendChild(script);
  }, [authStatus]);

  useEffect(() => {
    if (authStatus === "authenticated") {
      const redirectTo = params.get("next") || "/dashboard";
      router.replace(redirectTo);
    }
  }, [authStatus, params, router]);

  if (authStatus === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950">
        <div className="flex items-center gap-3 rounded-full border border-slate-800/60 bg-slate-900/60 px-6 py-3 text-sm text-slate-300 shadow-inner shadow-black/40">
          <span className="h-3 w-3 animate-ping rounded-full bg-sky-400" />
          Checking session…
        </div>
      </div>
    );
  }

  if (authStatus === "authenticated") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950">
        <div className="flex items-center gap-3 rounded-full border border-slate-800/60 bg-slate-900/60 px-6 py-3 text-sm text-slate-300 shadow-inner shadow-black/40">
          <span className="h-3 w-3 animate-ping rounded-full bg-sky-400" />
          Redirecting to dashboard…
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-slate-950 px-6 py-16">
      <div className="pointer-events-none absolute inset-0 z-10 opacity-70 mix-blend-soft-light bg-[radial-gradient(circle_at_10%_20%,rgba(56,189,248,0.35),rgba(15,23,42,0.9)55%,rgba(2,6,23,1))]" />
      <div className="relative z-10 grid w-full max-w-5xl grid-cols-1 gap-8 lg:grid-cols-[1.15fr,0.85fr]">
        <Card className="space-y-6 border-slate-800/60 bg-slate-950/80">
          <CardHeader>
            <Badge variant="sky" className="w-fit">
              Secure admin login
            </Badge>
            <CardTitle className="text-3xl sm:text-4xl">Manage your bridge with Telegram login</CardTitle>
            <CardDescription>
              Authenticate to the dashboard to register bots and destinations, create GitHub subscriptions, and monitor delivery logs.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert variant="info">
              <AlertDescription>
                Ensure the domain configured in BotFather matches this frontend. Once you are signed in, the session lives in an
                HTTP-only cookie and expires automatically.
              </AlertDescription>
            </Alert>
            {authStatus === "error" && authStatusError && (
              <Alert variant="destructive">
                <AlertDescription>{authStatusError}</AlertDescription>
              </Alert>
            )}
            <ul className="space-y-3 text-sm text-slate-300">
              <li className="flex items-start gap-2">
                <span className="mt-1 text-sky-300">★</span>
                <span>Add multiple bots and sync their Telegram webhooks with a single click.</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-1 text-sky-300">★</span>
                <span>Register private chats, channels, or topics to receive tailored notifications.</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-1 text-sky-300">★</span>
                <span>Generate GitHub webhook URLs and secrets instantly for each repository.</span>
              </li>
            </ul>
            <div className="text-xs text-slate-500">
              Need a guide? Open the{" "}
              <button
                type="button"
                className="underline-offset-2 hover:text-slate-300 hover:underline"
                onClick={() => router.push("/")}
              >
                setup guide
              </button>
              .
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-800/60 bg-slate-950/80">
          <CardHeader>
            <CardTitle className="text-2xl">Telegram widget</CardTitle>
            <CardDescription>Use the button below to sign in with your Telegram account.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {TELEGRAM_BOT ? (
              <div className="flex flex-col items-center gap-4">
                <div ref={widgetRef} className="telegram-widget-container" />
                {processing && <p className="text-sm text-slate-400">Verifying…</p>}
              </div>
            ) : (
              <Alert variant="warning">
                <AlertDescription className="flex flex-col gap-3 text-xs text-amber-100">
                  <span>
                    Telegram login bot is not configured. Set{" "}
                    <code className="rounded bg-slate-900/70 px-1 py-0.5 text-[11px] text-amber-100">NEXT_PUBLIC_TELEGRAM_LOGIN_BOT</code>{" "}
                    in <code className="rounded bg-slate-900/70 px-1 py-0.5 text-[11px] text-amber-100">frontend/.env.local</code> and{" "}
                    <code className="rounded bg-slate-900/70 px-1 py-0.5 text-[11px] text-amber-100">LOGIN_BOT_TOKEN</code> in{" "}
                    <code className="rounded bg-slate-900/70 px-1 py-0.5 text-[11px] text-amber-100">backend/.env</code>.
                  </span>
                  <Button variant="secondary" size="sm" onClick={() => router.refresh()}>
                    Reload after updating env
                  </Button>
                </AlertDescription>
              </Alert>
            )}
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
