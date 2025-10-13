"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, api } from "../../../lib/api";
import { toast } from "../../../components/ui/sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";
import { Alert, AlertDescription } from "../../../components/ui/alert";
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { cn } from "../../../lib/utils";
import type { LucideIcon } from "lucide-react";
import { Activity, AlertTriangle, Bot, GitBranch, MapPin, MinusCircle, ShieldCheck, Users } from "lucide-react";

interface StatsPayload {
  summary: { users: number; bots: number; destinations: number; subscriptions: number; events: number };
  users: Array<{
    id: number;
    username: string;
    telegramMasked: string;
    isAdmin: boolean;
    bots: number;
    destinations: number;
    subscriptions: number;
    firstSeenAt: string;
  }>;
  subscriptions: Array<{
    id: number;
    repo: string;
    events: string;
    ownerUsername: string;
    ownerMasked: string;
    destinationTitle: string;
    destinationMasked: string;
    topicId: number | null;
    createdAt: string;
  }>;
  events: Array<{
    id: number;
    createdAt: string;
    eventType: string;
    repository: string;
    status: string;
    summary: string;
    error: string | null;
  }>;
}

const eventStatusStyles: Record<string, { className: string; icon: LucideIcon }> = {
  success: { className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-200", icon: ShieldCheck },
  error: { className: "border-red-500/40 bg-red-500/10 text-red-200", icon: AlertTriangle },
  ignored: { className: "border-slate-700/60 bg-slate-900/70 text-slate-200", icon: MinusCircle }
};

type SummaryTile = {
  label: string;
  value: number;
  hint: string;
  icon: LucideIcon;
  accent: string;
};

export default function StatsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<StatsPayload | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const fetchStats = useCallback(
    async (mode: "initial" | "refresh" = "initial") => {
      if (mode === "initial") {
        setLoading(true);
      } else {
        setRefreshing(true);
      }
      try {
        const response = await api.stats();
        setData(response);
        setLastUpdated(new Date());
        setError(null);
      } catch (err) {
        if (err instanceof ApiError && err.status === 403) {
          router.replace("/dashboard");
          return;
        }
        setError(err instanceof Error ? err.message : "Failed to load stats");
        toast.error(err instanceof Error ? err.message : "Failed to load stats");
      } finally {
        if (mode === "initial") {
          setLoading(false);
        } else {
          setRefreshing(false);
        }
      }
    },
    [router]
  );

  useEffect(() => {
    void fetchStats("initial");
  }, [fetchStats]);

  const handleRefresh = useCallback(() => {
    void fetchStats("refresh");
  }, [fetchStats]);

  const formattedUpdatedAt = useMemo(() => {
    if (!lastUpdated) {
      return "Never refreshed";
    }
    return lastUpdated.toLocaleString();
  }, [lastUpdated]);

  const summaryTiles = useMemo<SummaryTile[]>(() => {
    if (!data) {
      return [];
    }
    const { summary } = data;
    return [
      {
        label: "Users",
        value: summary.users,
        hint: "Admins currently managing the bridge.",
        icon: Users,
        accent: "border-sky-500/40 bg-sky-500/10 text-sky-100"
      },
      {
        label: "Bots",
        value: summary.bots,
        hint: "Telegram bots with active webhook bindings.",
        icon: Bot,
        accent: "border-emerald-500/40 bg-emerald-500/10 text-emerald-100"
      },
      {
        label: "Destinations",
        value: summary.destinations,
        hint: "Chats, channels, or topics connected to bots.",
        icon: MapPin,
        accent: "border-amber-500/40 bg-amber-500/10 text-amber-100"
      },
      {
        label: "Subscriptions",
        value: summary.subscriptions,
        hint: "GitHub repositories wired into Telegram.",
        icon: GitBranch,
        accent: "border-violet-500/40 bg-violet-500/10 text-violet-100"
      },
      {
        label: "Events logged",
        value: summary.events,
        hint: "Total webhook deliveries captured so far.",
        icon: Activity,
        accent: "border-pink-500/40 bg-pink-500/10 text-pink-100"
      }
    ];
  }, [data]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950">
        <div className="flex items-center gap-3 rounded-full border border-slate-800/60 bg-slate-900/60 px-6 py-3 text-sm text-slate-300 shadow-inner shadow-black/40">
          <span className="h-3 w-3 animate-ping rounded-full bg-sky-400" />
          Loading stats…
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 px-6">
        <Alert variant="destructive" className="max-w-lg">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!data) {
    return null;
  }

  return (
    <div className="relative min-h-screen bg-slate-950 text-slate-100">
      <div className="pointer-events-none absolute inset-0 z-10 opacity-70 mix-blend-soft-light bg-[radial-gradient(circle_at_15%_20%,rgba(56,189,248,0.3),rgba(15,23,42,0.95)55%,rgba(2,6,23,1))]" />
      <div className="relative z-10 mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 pb-20 pt-12 lg:px-12">
        <Card className="relative overflow-hidden border border-slate-800/60 bg-slate-950/80">
          <div className="pointer-events-none absolute -top-20 right-0 h-44 w-44 rounded-full bg-sky-500/15 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-24 left-12 h-40 w-40 rounded-full bg-violet-500/15 blur-3xl" />
          <CardHeader className="relative flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <Badge variant="sky" className="flex items-center gap-1 rounded-full border-sky-500/40 bg-sky-500/10 px-3 py-1 text-sky-100">
                  Insights
                </Badge>
                <span className="rounded-full border border-slate-800/60 bg-slate-900/60 px-3 py-1 text-slate-300">
                  Last updated {formattedUpdatedAt}
                </span>
                {refreshing && (
                  <span className="rounded-full border border-sky-500/30 bg-sky-500/10 px-3 py-1 text-sky-200">
                    Refreshing…
                  </span>
                )}
              </div>
              <CardTitle className="text-3xl tracking-tight text-slate-50 lg:text-4xl">Stats dashboard</CardTitle>
              <CardDescription className="text-sm text-slate-300">
                A bird’s-eye view of users, bots, destinations, and the most recent webhook deliveries.
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refreshing}>
                {refreshing ? "Refreshing…" : "Refresh data"}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => router.push("/dashboard")}>
                Back to dashboard
              </Button>
            </div>
          </CardHeader>
        </Card>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {summaryTiles.map((tile) => {
            const Icon = tile.icon;
            return (
              <Card
                key={tile.label}
                className="relative overflow-hidden border border-slate-800/60 bg-slate-950/75 transition hover:border-slate-700 hover:bg-slate-900/70"
              >
                <CardContent className="flex flex-col gap-4 p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-2">
                      <p className="text-xs uppercase tracking-wide text-slate-400">{tile.label}</p>
                      <p className="text-3xl font-semibold text-slate-50">{tile.value.toLocaleString()}</p>
                    </div>
                    <div
                      className={cn(
                        "flex h-11 w-11 items-center justify-center rounded-xl border text-slate-100 shadow-inner shadow-black/30",
                        tile.accent
                      )}
                    >
                      <Icon className="h-5 w-5" />
                    </div>
                  </div>
                  <p className="text-xs text-slate-500">{tile.hint}</p>
                </CardContent>
              </Card>
            );
          })}
        </div>

        <Card className="border-slate-800/60 bg-slate-950/75">
          <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle>Per-user overview</CardTitle>
              <CardDescription>Masked Telegram IDs plus a quick tally of resources owned by each admin.</CardDescription>
            </div>
            <Badge variant="default" className="rounded-full border-slate-800/60 bg-slate-900/60 text-[11px] uppercase tracking-wide text-slate-300">
              {data.users.length.toLocaleString()} users
            </Badge>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="min-w-full overflow-hidden rounded-2xl border border-slate-800/60 text-sm">
              <thead className="bg-slate-900/70 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="px-4 py-3">Username</th>
                  <th className="px-4 py-3">Telegram</th>
                  <th className="px-4 py-3">Admin</th>
                  <th className="px-4 py-3">Bots</th>
                  <th className="px-4 py-3">Destinations</th>
                  <th className="px-4 py-3">Subscriptions</th>
                  <th className="px-4 py-3">First seen</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 bg-slate-950/40 text-slate-200">
                {data.users.length > 0 ? (
                  data.users.map((user) => (
                    <tr key={user.id} className="hover:bg-slate-900/60">
                      <td className="px-4 py-3">{user.username}</td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-400">{user.telegramMasked}</td>
                      <td className="px-4 py-3">
                        {user.isAdmin ? (
                          <Badge variant="emerald" className="rounded-full border-emerald-500/40 bg-emerald-500/10 text-[10px] uppercase tracking-wide">
                            Admin
                          </Badge>
                        ) : (
                          <span className="text-slate-600">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">{user.bots}</td>
                      <td className="px-4 py-3">{user.destinations}</td>
                      <td className="px-4 py-3">{user.subscriptions}</td>
                      <td className="px-4 py-3 text-xs text-slate-400">{user.firstSeenAt}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={7} className="px-4 py-6 text-center text-slate-500">
                      No users yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>

        <Card className="border-slate-800/60 bg-slate-950/75">
          <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle>Recent subscriptions</CardTitle>
              <CardDescription>The most recent 50 subscriptions with their destinations.</CardDescription>
            </div>
            <Badge variant="default" className="rounded-full border-slate-800/60 bg-slate-900/60 text-[11px] uppercase tracking-wide text-slate-300">
              {data.subscriptions.length.toLocaleString()} tracked
            </Badge>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.subscriptions.length > 0 ? (
              data.subscriptions.map((sub) => {
                const destinationHasTitle = Boolean(sub.destinationTitle);
                return (
                  <div key={sub.id} className="rounded-2xl border border-slate-800/60 bg-slate-900/60 p-4 text-sm text-slate-300">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-slate-100">{sub.repo}</span>
                        <Badge variant="default" className="border-slate-700/60 bg-slate-900/70 text-[10px] uppercase tracking-wide">
                          {sub.events}
                        </Badge>
                      </div>
                      <span className="text-xs text-slate-500">Created {sub.createdAt}</span>
                    </div>
                    <div className="mt-3 grid gap-2 text-xs text-slate-400 sm:grid-cols-2">
                      <div className="flex flex-wrap items-center gap-1">
                        <span>Owner:</span>
                        <span className="text-slate-200">{sub.ownerUsername}</span>
                        <span className="text-slate-600">({sub.ownerMasked})</span>
                      </div>
                      <div className="flex flex-wrap items-center gap-1">
                        <span>Destination:</span>
                        <span className="text-slate-200">
                          {destinationHasTitle ? sub.destinationTitle : sub.destinationMasked}
                        </span>
                        {destinationHasTitle && <span className="text-slate-600">({sub.destinationMasked})</span>}
                      </div>
                      {sub.topicId && (
                        <div className="flex flex-wrap items-center gap-1">
                          <span>Topic ID:</span>
                          <span className="text-slate-200">{sub.topicId}</span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            ) : (
              <Alert variant="info">
                <AlertDescription>No recent subscriptions.</AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>

        <Card className="border-slate-800/60 bg-slate-950/75">
          <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle>Recent webhook events</CardTitle>
              <CardDescription>The latest 50 webhook deliveries with status and rich summaries.</CardDescription>
            </div>
            <Badge variant="default" className="rounded-full border-slate-800/60 bg-slate-900/60 text-[11px] uppercase tracking-wide text-slate-300">
              {data.events.length.toLocaleString()} logged
            </Badge>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.events.length > 0 ? (
              data.events.map((event) => {
                const statusKey = event.status.toLowerCase();
                const statusInfo = eventStatusStyles[statusKey] ?? {
                  className: "border-slate-700/60 bg-slate-900/70 text-slate-200",
                  icon: Activity
                };
                const StatusIcon = statusInfo.icon;
                return (
                  <div key={event.id} className="rounded-2xl border border-slate-800/60 bg-slate-900/60 p-4 text-sm text-slate-300">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                          <span>{event.createdAt}</span>
                          <span>•</span>
                          <span>{event.eventType}</span>
                          <span>•</span>
                          <span>{event.repository}</span>
                        </div>
                        <span
                          className={cn(
                            "mt-3 inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-[11px] uppercase tracking-wide",
                            statusInfo.className
                          )}
                        >
                          <StatusIcon className="h-3.5 w-3.5" />
                          {event.status}
                        </span>
                      </div>
                      {event.error && (
                        <Alert variant="destructive" className="w-full text-xs sm:w-auto">
                          <AlertDescription>{event.error}</AlertDescription>
                        </Alert>
                      )}
                    </div>
                    <div
                      className="mt-3 whitespace-pre-wrap rounded-xl border border-slate-800/60 bg-slate-950/60 p-3 text-xs text-slate-200"
                      dangerouslySetInnerHTML={{ __html: event.summary.trim() || "—" }}
                    />
                  </div>
                );
              })
            ) : (
              <Alert variant="info">
                <AlertDescription>No webhook events recorded yet.</AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
