"use client";

import { toast } from "@/components/ui/sonner";
import {
  ApiError,
  api,
  type ApiBot,
  type ApiChatLookupCandidate,
  type ApiDestination,
  type ApiSubscription,
  type ApiWebhookInfo,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import { Badge } from "components/ui/badge";
import { Button } from "components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "components/ui/card";
import type { LucideIcon } from "lucide-react";
import {
  ArrowRight,
  Bot,
  GitBranch,
  MapPin,
  Send,
  Sparkles,
  Workflow,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { BotsPanel } from "./BotsPanel";
import { DestinationsPanel } from "./DestinationsPanel";
import { GithubInsights } from "./GithubInsights";
import { SubscriptionsPanel } from "./SubscriptionsPanel";
import { useChatLookup } from "./useChatLookup";
import { useGithubIntegration } from "./useGithubIntegration";

type BotDetails = {
  webhookInfo: ApiWebhookInfo;
};

type WebhookHelper = {
  repo: string;
  payloadUrl: string;
  secret: string;
  events: string;
  contentType: string;
  botLabel: string;
  destinationLabel: string;
};

const selectClass =
  "h-10 w-full rounded-xl border border-slate-800/60 bg-slate-950/60 px-3 text-sm text-slate-100 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";

type DashboardMetric = {
  label: string;
  value: number;
  hint: string;
  icon: LucideIcon;
  accent: string;
};

type QuickAction = {
  label: string;
  description: string;
  onClick: () => void;
  icon: LucideIcon;
  accent: string;
  badge: string;
};

export default function DashboardPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [bots, setBots] = useState<ApiBot[]>([]);
  const [botDetails, setBotDetails] = useState<
    Record<number, BotDetails | undefined>
  >({});
  const [loadingBotInfoId, setLoadingBotInfoId] = useState<number | null>(null);
  const [newToken, setNewToken] = useState("");
  const [dropPendingUpdatesOnCreate, setDropPendingUpdatesOnCreate] =
    useState(false);
  const [rotatingBotId, setRotatingBotId] = useState<number | null>(null);
  const [rotateTokenValue, setRotateTokenValue] = useState("");
  const [destinations, setDestinations] = useState<ApiDestination[]>([]);
  const [editingDestinationId, setEditingDestinationId] = useState<
    number | null
  >(null);
  const [destinationForm, setDestinationForm] = useState({
    chatId: "",
    title: "",
    topicId: "",
    isDefault: false,
  });
  const [newDestination, setNewDestination] = useState({
    chatId: "",
    title: "",
    topicId: "",
    isDefault: false,
  });
  const [subscriptions, setSubscriptions] = useState<ApiSubscription[]>([]);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [isMounted, setIsMounted] = useState(false);

  const notifyError = useCallback((message: string) => {
    toast.error(message);
  }, []);

  const notifySuccess = useCallback((message: string) => {
    toast.success(message);
  }, []);

  const {
    isGithubConnected,
    githubAccountUsername,
    loadingGithubStatus,
    githubRepos,
    loadingGithubRepos,
    githubWebhooksMap,
    githubWebhookErrors,
    githubWebhooksLoading,
    githubWebhooksFetched,
    githubWebhooksExhausted,
    githubConnecting,
    githubDisconnecting,
    loadGithubRepos,
    loadGithubRepoWebhooks,
    handleConnectGithub,
    handleDisconnectGithub,
    handleGithubIntegrationFeedback,
  } = useGithubIntegration();

  useEffect(() => {
    const load = async () => {
      try {
        await api.me();
        const [botsRes, destRes, subsRes] = await Promise.all([
          api.bots.list(),
          api.destinations.list(),
          api.subscriptions.list(),
        ]);
        setBots(botsRes.bots);
        setDestinations(destRes.destinations);
        setSubscriptions(subsRes.subscriptions);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          router.replace("/login");
          return;
        }
        notifyError(
          err instanceof Error ? err.message : "Failed to load dashboard"
        );
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [router, notifyError]);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  const stats = useMemo<DashboardMetric[]>(
    () => [
      {
        label: "Bots",
        value: bots.length,
        hint: "Connected Telegram bots ready to deliver notifications.",
        icon: Bot,
        accent: "border-sky-500/40 bg-sky-500/10 text-sky-100",
      },
      {
        label: "Destinations",
        value: destinations.length,
        hint: "Chats, channels, or topics currently linked to bots.",
        icon: MapPin,
        accent: "border-emerald-500/40 bg-emerald-500/10 text-emerald-100",
      },
      {
        label: "Subscriptions",
        value: subscriptions.length,
        hint: "Repositories with GitHub webhooks pointing to this bridge.",
        icon: GitBranch,
        accent: "border-violet-500/40 bg-violet-500/10 text-violet-100",
      },
    ],
    [bots.length, destinations.length, subscriptions.length]
  );

  const botOptions = useMemo(
    () =>
      bots.map((bot) => ({
        value: String(bot.id),
        label: bot.displayName || bot.botId,
      })),
    [bots]
  );

  const handleChatLookupSelection = useCallback(
    (candidate: ApiChatLookupCandidate | null) => {
      if (!candidate) {
        return;
      }
      setNewDestination((prev) => {
        const next = {
          ...prev,
          chatId: candidate.chatId,
          title: prev.title || candidate.title || "",
          topicId: candidate.topicId ? String(candidate.topicId) : prev.topicId,
        };
        if (
          prev.chatId === next.chatId &&
          prev.title === next.title &&
          prev.topicId === next.topicId
        ) {
          return prev;
        }
        return next;
      });
    },
    [setNewDestination]
  );

  const {
    chatLookupBotId,
    setChatLookupBotId,
    chatLookupState,
    chatLookupCandidates,
    chatLookupSelectionKey,
    setChatLookupSelectionKey,
    chatLookupLoading,
    chatLookupStopping,
    handleStartChatLookup,
    handleStopChatLookup,
    handleResetChatLookup,
    isChatLookupPending,
    isChatLookupReady,
    canResetChatLookup,
    showStopChatLookup,
  } = useChatLookup({
    botOptions,
    onSelection: handleChatLookupSelection,
  });

  const botLabelMap = useMemo(() => {
    const map = new Map<number, string>();
    bots.forEach((bot) => map.set(bot.id, bot.displayName || bot.botId));
    return map;
  }, [bots]);

  const destinationOptions = useMemo(
    () =>
      destinations.map((dest) => ({
        value: String(dest.id),
        label: dest.title ? `${dest.title} (${dest.chatId})` : dest.chatId,
        isDefault: dest.isDefault,
      })),
    [destinations]
  );

  const destinationLabelMap = useMemo(() => {
    const map = new Map<number, string>();
    destinations.forEach((dest) =>
      map.set(
        dest.id,
        dest.title ? `${dest.title} (${dest.chatId})` : dest.chatId
      )
    );
    return map;
  }, [destinations]);

  const botIsInUse = useCallback(
    (botId: number) =>
      subscriptions.some((subscription) => subscription.botId === botId),
    [subscriptions]
  );

  const destinationIsInUse = useCallback(
    (destinationId: number) =>
      subscriptions.some(
        (subscription) => subscription.destinationId === destinationId
      ),
    [subscriptions]
  );

  const setBotWebhookDetails = (id: number, info: ApiWebhookInfo) => {
    setBotDetails((prev) => ({ ...prev, [id]: { webhookInfo: info } }));
  };

  const handleAddBot = async () => {
    setBusyAction("add-bot");
    try {
      const response = await api.bots.create({
        token: newToken,
        dropPendingUpdates: dropPendingUpdatesOnCreate,
      });
      setBots((prev) => [response.bot, ...prev]);
      setBotWebhookDetails(response.bot.id, response.webhookInfo);
      setNewToken("");
      setDropPendingUpdatesOnCreate(false);
      notifySuccess("Bot added successfully.");
    } catch (err) {
      notifyError(err instanceof Error ? err.message : "Failed to add bot");
    } finally {
      setBusyAction(null);
    }
  };

  const handleInspectWebhook = async (id: number) => {
    setLoadingBotInfoId(id);
    try {
      const response = await api.bots.info(id);
      setBots((prev) =>
        prev.map((bot) =>
          bot.id === id
            ? {
                ...bot,
                displayName: response.bot.displayName,
                token: response.bot.token,
              }
            : bot
        )
      );
      setBotWebhookDetails(id, response.webhookInfo);
    } catch (err) {
      notifyError(
        err instanceof Error ? err.message : "Failed to fetch webhook info"
      );
    } finally {
      setLoadingBotInfoId(null);
    }
  };

  const handleRotateToken = async (id: number) => {
    if (!rotateTokenValue.trim()) {
      notifyError("Token cannot be empty.");
      return;
    }
    setBusyAction(`rotate-bot-${id}`);
    try {
      const response = await api.bots.updateToken(id, {
        token: rotateTokenValue.trim(),
      });
      setBots((prev) =>
        prev.map((bot) =>
          bot.id === id
            ? {
                ...bot,
                token: rotateTokenValue.trim(),
                displayName: response.displayName || bot.displayName,
              }
            : bot
        )
      );
      setBotWebhookDetails(id, response.webhookInfo);
      setRotatingBotId(null);
      setRotateTokenValue("");
      notifySuccess("Bot token updated.");
    } catch (err) {
      notifyError(
        err instanceof Error ? err.message : "Failed to update token"
      );
    } finally {
      setBusyAction(null);
    }
  };

  const handleRemoveBot = async (id: number) => {
    if (botIsInUse(id)) {
      notifyError(
        "Remove subscriptions linked to this bot before deleting it."
      );
      return;
    }
    setBusyAction(`delete-bot-${id}`);
    try {
      await api.bots.remove(id);
      setBots((prev) => prev.filter((bot) => bot.id !== id));
      setBotDetails((prev) => {
        const clone = { ...prev };
        delete clone[id];
        return clone;
      });
      notifySuccess("Bot removed.");
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        notifyError(
          "Remove subscriptions linked to this bot before deleting it."
        );
      } else {
        notifyError(
          err instanceof Error ? err.message : "Failed to remove bot"
        );
      }
    } finally {
      setBusyAction(null);
    }
  };

  const handleDropPendingUpdates = async (id: number) => {
    setBusyAction(`drop-updates-${id}`);
    try {
      const response = await api.bots.dropPendingUpdates(id);
      setBotWebhookDetails(id, response.webhookInfo);
      notifySuccess("Pending updates dropped.");
    } catch (err) {
      notifyError(
        err instanceof Error ? err.message : "Failed to drop pending updates"
      );
    } finally {
      setBusyAction(null);
    }
  };

  const handleAddDestination = async () => {
    setBusyAction("add-destination");
    try {
      const chatId = newDestination.chatId.trim();
      if (!chatId) {
        notifyError("Chat ID is required.");
        return;
      }
      const payload: {
        chatId: string;
        title?: string;
        isDefault?: boolean;
        topicId?: string | number;
      } = {
        chatId,
        isDefault: newDestination.isDefault,
      };
      if (newDestination.title.trim()) {
        payload.title = newDestination.title.trim();
      }
      if (newDestination.topicId.trim()) {
        payload.topicId = newDestination.topicId.trim();
      }
      const response = await api.destinations.create(payload);
      setDestinations((prev) => {
        const updated = newDestination.isDefault
          ? prev.map((d) => ({ ...d, isDefault: false }))
          : prev;
        return [response.destination, ...updated];
      });
      setNewDestination({
        chatId: "",
        title: "",
        topicId: "",
        isDefault: false,
      });
      notifySuccess("Destination added.");
    } catch (err) {
      notifyError(
        err instanceof Error ? err.message : "Failed to add destination"
      );
    } finally {
      setBusyAction(null);
    }
  };

  const startEditDestination = (destination: ApiDestination) => {
    setEditingDestinationId(destination.id);
    setDestinationForm({
      chatId: destination.chatId,
      title: destination.title || "",
      topicId: destination.topicId !== null ? String(destination.topicId) : "",
      isDefault: destination.isDefault,
    });
  };

  const cancelEditDestination = () => {
    setEditingDestinationId(null);
    setDestinationForm({
      chatId: "",
      title: "",
      topicId: "",
      isDefault: false,
    });
  };

  const saveDestination = async (id: number) => {
    setBusyAction(`update-destination-${id}`);
    try {
      await api.destinations.update(id, {
        chatId: destinationForm.chatId,
        title: destinationForm.title,
        topicId:
          destinationForm.topicId === "" ? null : destinationForm.topicId,
        isDefault: destinationForm.isDefault,
      });
      setDestinations((prev) =>
        prev.map((dest) => {
          if (dest.id !== id) {
            return destinationForm.isDefault
              ? { ...dest, isDefault: false }
              : dest;
          }
          return {
            ...dest,
            chatId: destinationForm.chatId,
            title: destinationForm.title,
            topicId:
              destinationForm.topicId === ""
                ? null
                : Number(destinationForm.topicId),
            isDefault: destinationForm.isDefault,
          };
        })
      );
      cancelEditDestination();
      notifySuccess("Destination updated.");
    } catch (err) {
      notifyError(
        err instanceof Error ? err.message : "Failed to update destination"
      );
    } finally {
      setBusyAction(null);
    }
  };

  const handleSetDefaultDestination = async (id: number) => {
    setBusyAction(`default-destination-${id}`);
    try {
      await api.destinations.setDefault(id);
      setDestinations((prev) =>
        prev.map((dest) => ({ ...dest, isDefault: dest.id === id }))
      );
      notifySuccess("Default destination updated.");
    } catch (err) {
      notifyError(
        err instanceof Error ? err.message : "Failed to set default destination"
      );
    } finally {
      setBusyAction(null);
    }
  };

  const handleRemoveDestination = async (id: number) => {
    if (destinationIsInUse(id)) {
      notifyError(
        "Remove subscriptions linked to this destination before deleting it."
      );
      return;
    }
    setBusyAction(`delete-destination-${id}`);
    try {
      await api.destinations.remove(id);
      setDestinations((prev) => prev.filter((dest) => dest.id !== id));
      if (editingDestinationId === id) {
        cancelEditDestination();
      }
      notifySuccess("Destination removed.");
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        notifyError(
          "Remove subscriptions linked to this destination before deleting it."
        );
      } else {
        notifyError(
          err instanceof Error ? err.message : "Failed to remove destination"
        );
      }
    } finally {
      setBusyAction(null);
    }
  };

  const scrollToElement = useCallback((elementId: string) => {
    if (typeof window === "undefined") {
      return;
    }
    const element = document.getElementById(elementId);
    if (!element) {
      return;
    }
    element.scrollIntoView({ behavior: "smooth", block: "center" });
    if (
      element instanceof HTMLInputElement ||
      element instanceof HTMLSelectElement ||
      element instanceof HTMLTextAreaElement
    ) {
      element.focus({ preventScroll: true });
    }
  }, []);

  const jumpToBots = useCallback(
    () => scrollToElement("bot-token-input"),
    [scrollToElement]
  );
  const jumpToDestinations = useCallback(
    () => scrollToElement("dest-chat"),
    [scrollToElement]
  );
  const jumpToSubscriptions = useCallback(
    () => scrollToElement("subscription-repo"),
    [scrollToElement]
  );

  const quickActions = useMemo<QuickAction[]>(
    () => [
      {
        label: "Register a bot",
        description:
          "Store the BotFather token securely and refresh the Telegram webhook automatically.",
        onClick: jumpToBots,
        icon: Bot,
        accent: "border-sky-500/40 bg-sky-500/10 text-sky-100",
        badge: "Step 1",
      },
      {
        label: "Add a destination",
        description:
          "Connect chats, channels, or topics so each team receives the right updates.",
        onClick: jumpToDestinations,
        icon: Send,
        accent: "border-emerald-500/40 bg-emerald-500/10 text-emerald-100",
        badge: "Step 2",
      },
      {
        label: "Create a subscription",
        description:
          "Generate GitHub webhook URLs and secrets for the repos that matter.",
        onClick: jumpToSubscriptions,
        icon: Workflow,
        accent: "border-violet-500/40 bg-violet-500/10 text-violet-100",
        badge: "Step 3",
      },
    ],
    [jumpToBots, jumpToDestinations, jumpToSubscriptions]
  );

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950">
        <div className="flex items-center gap-3 rounded-full border border-slate-800/60 bg-slate-900/60 px-6 py-3 text-sm text-slate-300 shadow-inner shadow-black/40">
          <span className="h-3 w-3 animate-ping rounded-full bg-sky-400" />
          Loading dashboard…
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen bg-slate-950 text-slate-50">
      <div className="pointer-events-none absolute inset-0 z-10 opacity-70 mix-blend-soft-light bg-[radial-gradient(circle_at_15%_20%,rgba(56,189,248,0.3),rgba(15,23,42,0.88)55%,rgba(2,6,23,1))]" />
      <div className="relative z-10 mx-auto flex w-full max-w-7xl flex-col gap-8 px-6 pb-16 pt-12 lg:px-16">
        <Card className="relative overflow-hidden border border-slate-800/60 bg-slate-950/80">
          <div className="pointer-events-none absolute -top-24 right-4 h-48 w-48 rounded-full bg-sky-500/15 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-28 left-0 h-48 w-48 rounded-full bg-violet-500/15 blur-3xl" />
          <CardHeader className="relative flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <Badge
                  variant="emerald"
                  className="flex items-center gap-1 rounded-full border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-emerald-100">
                  <Sparkles className="h-3 w-3" />
                  Live bridge
                </Badge>
                <span className="rounded-full border border-slate-800/60 bg-slate-900/60 px-3 py-1 text-slate-300">
                  {subscriptions.length.toLocaleString()} active subscriptions
                </span>
                <span className="rounded-full border border-slate-800/60 bg-slate-900/60 px-3 py-1 text-slate-300">
                  {bots.length.toLocaleString()} bots encrypted
                </span>
              </div>
              <CardTitle className="text-3xl tracking-tight text-slate-50 lg:text-4xl">
                GitHub → Telegram control center
              </CardTitle>
              <CardDescription className="text-sm text-slate-300">
                Monitor every integration, onboard new destinations, and keep
                delivery flowing without leaving this screen.
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => router.push("/stats")}>
                Open stats
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  await api.auth.logout();
                  router.replace("/login");
                }}>
                Sign out
              </Button>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="grid gap-3 md:grid-cols-3">
              {quickActions.map((action) => {
                const Icon = action.icon;
                return (
                  <button
                    key={action.label}
                    type="button"
                    onClick={action.onClick}
                    className="group relative flex h-full flex-col justify-between rounded-2xl border border-slate-800/70 bg-slate-900/60 p-4 text-left transition hover:border-sky-500/40 hover:bg-slate-900/80">
                    <div className="flex items-start justify-between gap-2">
                      <div
                        className={cn(
                          "flex h-11 w-11 items-center justify-center rounded-xl border text-slate-100 shadow-inner shadow-black/40 transition group-hover:scale-105",
                          action.accent
                        )}>
                        <Icon className="h-5 w-5" />
                      </div>
                      <Badge
                        variant="default"
                        className="border-transparent bg-slate-900/40 text-[10px] uppercase tracking-wide text-slate-300">
                        {action.badge}
                      </Badge>
                    </div>
                    <div className="mt-4 space-y-2">
                      <p className="text-sm font-semibold text-slate-100">
                        {action.label}
                      </p>
                      <p className="text-xs text-slate-400">
                        {action.description}
                      </p>
                    </div>
                    <span className="mt-4 inline-flex items-center text-xs font-medium text-sky-300 transition-transform group-hover:translate-x-1">
                      Explore <ArrowRight className="ml-1 h-3.5 w-3.5" />
                    </span>
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-4 md:grid-cols-3">
          {stats.map((item) => {
            const Icon = item.icon;
            return (
              <Card
                key={item.label}
                className="relative overflow-hidden border border-slate-800/60 bg-slate-950/75 transition hover:border-slate-700 hover:bg-slate-900/70">
                <CardContent className="flex flex-col gap-4 p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-2">
                      <p className="text-xs uppercase tracking-wide text-slate-400">
                        {item.label}
                      </p>
                      <p className="text-3xl font-semibold text-slate-50">
                        {item.value.toLocaleString()}
                      </p>
                    </div>
                    <div
                      className={cn(
                        "flex h-11 w-11 items-center justify-center rounded-xl border text-slate-100 shadow-inner shadow-black/30",
                        item.accent
                      )}>
                      <Icon className="h-5 w-5" />
                    </div>
                  </div>
                  <p className="text-xs text-slate-500">{item.hint}</p>
                </CardContent>
              </Card>
            );
          })}
        </div>
        <GithubInsights onOpenStats={() => router.push("/stats")} />
        <BotsPanel
          bots={bots}
          botDetails={botDetails}
          loadingBotInfoId={loadingBotInfoId}
          newToken={newToken}
          setNewToken={setNewToken}
          dropPendingUpdatesOnCreate={dropPendingUpdatesOnCreate}
          setDropPendingUpdatesOnCreate={setDropPendingUpdatesOnCreate}
          rotatingBotId={rotatingBotId}
          setRotatingBotId={setRotatingBotId}
          rotateTokenValue={rotateTokenValue}
          setRotateTokenValue={setRotateTokenValue}
          busyAction={busyAction}
          handleAddBot={handleAddBot}
          handleInspectWebhook={handleInspectWebhook}
          handleDropPendingUpdates={handleDropPendingUpdates}
          handleRotateToken={handleRotateToken}
          handleRemoveBot={handleRemoveBot}
          botIsInUse={botIsInUse}
          setBotWebhookDetails={setBotWebhookDetails}
        />

        <DestinationsPanel
          destinations={destinations}
          botOptions={botOptions}
          newDestination={newDestination}
          setNewDestination={setNewDestination}
          destinationForm={destinationForm}
          setDestinationForm={setDestinationForm}
          editingDestinationId={editingDestinationId}
          busyAction={busyAction}
          destinationIsInUse={destinationIsInUse}
          handleAddDestination={handleAddDestination}
          startEditDestination={startEditDestination}
          cancelEditDestination={cancelEditDestination}
          saveDestination={saveDestination}
          handleSetDefaultDestination={handleSetDefaultDestination}
          handleRemoveDestination={handleRemoveDestination}
          chatLookup={{
            botOptions,
            chatLookupBotId,
            setChatLookupBotId,
            chatLookupCandidates,
            chatLookupSelectionKey,
            setChatLookupSelectionKey,
            chatLookupState,
            chatLookupLoading,
            chatLookupStopping,
            handleStartChatLookup,
            handleStopChatLookup,
            handleResetChatLookup,
            isChatLookupPending,
            isChatLookupReady,
            canResetChatLookup,
            showStopChatLookup,
          }}
        />

        <SubscriptionsPanel
          subscriptions={subscriptions}
          setSubscriptions={setSubscriptions}
          bots={bots}
          destinations={destinations}
          botOptions={botOptions}
          destinationOptions={destinationOptions}
          botLabelMap={botLabelMap}
          destinationLabelMap={destinationLabelMap}
          notifySuccess={notifySuccess}
          notifyError={notifyError}
          handleGithubIntegrationFeedback={handleGithubIntegrationFeedback}
          busyAction={busyAction}
          setBusyAction={setBusyAction}
          github={{
            isGithubConnected,
            loadingGithubStatus,
            githubAccountUsername,
            githubRepos,
            loadingGithubRepos,
            githubWebhooksMap,
            githubWebhookErrors,
            githubWebhooksLoading,
            githubWebhooksExhausted,
            githubConnecting,
            githubDisconnecting,
            onConnectGithub: handleConnectGithub,
            onDisconnectGithub: handleDisconnectGithub,
            onRefreshRepos: loadGithubRepos,
            onRefreshWebhooks: loadGithubRepoWebhooks,
            githubWebhooksFetched,
          }}
        />
      </div>
    </div>
  );
}
