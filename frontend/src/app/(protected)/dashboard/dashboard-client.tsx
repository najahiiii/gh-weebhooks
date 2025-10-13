"use client";

import type { LucideIcon } from "lucide-react";
import {
  ArrowRight,
  Bot,
  Check,
  ChevronsUpDown,
  GitBranch,
  Loader2,
  MapPin,
  Send,
  Sparkles,
  Workflow
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type UIEvent } from "react";
import { createPortal } from "react-dom";
import { Alert, AlertDescription } from "../../../components/ui/alert";
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList
} from "../../../components/ui/command";
import { Copyable } from "../../../components/ui/copyable";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import { toast } from "../../../components/ui/sonner";
import { Spinner } from "../../../components/ui/spinner";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../../../components/ui/tooltip";
import {
  ApiError,
  api,
  type ApiBot,
  type ApiDestination,
  type ApiGithubIntegration,
  type ApiGithubRepo,
  type ApiGithubStatus,
  type ApiGithubWebhook,
  type ApiSubscription,
  type ApiWebhookInfo,
  type ApiChatLookupCandidate
} from "../../../lib/api";
import { cn } from "../../../lib/utils";

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

const getChatLookupCandidateKey = (candidate: ApiChatLookupCandidate) =>
  `${candidate.chatId}::${candidate.topicId ?? "null"}`;

const normalizeChatLookupCandidates = (candidates: ApiChatLookupCandidate[]): ApiChatLookupCandidate[] => {
  const map = new Map<string, ApiChatLookupCandidate>();
  candidates.forEach((candidate) => {
    const key = getChatLookupCandidateKey(candidate);
    const existing = map.get(key);
    if (!existing || candidate.detectedAt > existing.detectedAt) {
      map.set(key, candidate);
    }
  });
  return Array.from(map.values()).sort((a, b) => b.detectedAt - a.detectedAt);
};

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

type GithubOAuthMessage = {
  source?: string;
  status?: "success" | "error" | string;
  message?: string;
  username?: string;
};

type ChatLookupState =
  | { status: "idle" }
  | {
      status: "pending";
      botId: number;
      chats: ApiChatLookupCandidate[];
      expiresAt: string | null;
    }
  | {
      status: "ready";
      botId: number;
      chats: ApiChatLookupCandidate[];
      expiresAt: string | null;
    }
  | { status: "expired" }
  | { status: "error"; message: string };

export default function DashboardPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [bots, setBots] = useState<ApiBot[]>([]);
  const [botDetails, setBotDetails] = useState<Record<number, BotDetails | undefined>>({});
  const [loadingBotInfoId, setLoadingBotInfoId] = useState<number | null>(null);
  const [newToken, setNewToken] = useState("");
  const [dropPendingUpdatesOnCreate, setDropPendingUpdatesOnCreate] = useState(false);
  const [rotatingBotId, setRotatingBotId] = useState<number | null>(null);
  const [rotateTokenValue, setRotateTokenValue] = useState("");
  const [destinations, setDestinations] = useState<ApiDestination[]>([]);
  const [editingDestinationId, setEditingDestinationId] = useState<number | null>(null);
  const [destinationForm, setDestinationForm] = useState({ chatId: "", title: "", topicId: "", isDefault: false });
  const [newDestination, setNewDestination] = useState({ chatId: "", title: "", topicId: "", isDefault: false });
  const [chatLookupBotId, setChatLookupBotId] = useState("");
  const [chatLookupState, setChatLookupState] = useState<ChatLookupState>({ status: "idle" });
  const [chatLookupSelectionKey, setChatLookupSelectionKey] = useState<string | null>(null);
  const chatLookupPollRef = useRef<number | null>(null);
  const [chatLookupLoading, setChatLookupLoading] = useState(false);
  const [chatLookupStopping, setChatLookupStopping] = useState(false);
  const chatLookupDetectedRef = useRef(false);
  const prevChatLookupBotId = useRef<string>("");
  const [subscriptions, setSubscriptions] = useState<ApiSubscription[]>([]);
  const [editingSubscriptionId, setEditingSubscriptionId] = useState<number | null>(null);
  const [eventsOptions, setEventsOptions] = useState<string[]>([]);
  const [createSelectedEvents, setCreateSelectedEvents] = useState<string[]>(["*"]);
  const [editSelectedEvents, setEditSelectedEvents] = useState<string[]>(["*"]);
  const [editSubscription, setEditSubscription] = useState({ repo: "", botId: "", destinationId: "", events: "*" });
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [newSubscription, setNewSubscription] = useState({ repo: "", events: "*", botId: "", destinationId: "" });
  const [latestWebhook, setLatestWebhook] = useState<WebhookHelper | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [isMounted, setIsMounted] = useState(false);
  const [githubStatus, setGithubStatus] = useState<ApiGithubStatus | null>(null);
  const [loadingGithubStatus, setLoadingGithubStatus] = useState(true);
  const [githubRepos, setGithubRepos] = useState<ApiGithubRepo[]>([]);
  const [loadingGithubRepos, setLoadingGithubRepos] = useState(false);
  const [githubConnecting, setGithubConnecting] = useState(false);
  const [githubDisconnecting, setGithubDisconnecting] = useState(false);
  const [githubWebhooksMap, setGithubWebhooksMap] = useState<Record<string, ApiGithubWebhook[]>>({});
  const [githubWebhookErrors, setGithubWebhookErrors] = useState<Record<string, string>>({});
  const [githubWebhooksLoading, setGithubWebhooksLoading] = useState(false);
  const [githubWebhooksFetched, setGithubWebhooksFetched] = useState(false);
  const [githubWebhooksExhausted, setGithubWebhooksExhausted] = useState(false);
  const githubPopupRef = useRef<Window | null>(null);
  const githubPopupWatcherRef = useRef<number | null>(null);

  const apiOrigin = useMemo(() => {
    const base = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:4000";
    try {
      return new URL(base).origin;
    } catch (error) {
      console.warn("Invalid NEXT_PUBLIC_API_BASE", error);
      return base;
    }
  }, []);

  const isGithubConnected = githubStatus?.connected === true;
  const githubAccountUsername = isGithubConnected ? githubStatus.account.username ?? "" : "";

  const notifyError = useCallback((message: string) => {
    toast.error(message);
  }, []);

  const notifySuccess = useCallback((message: string) => {
    toast.success(message);
  }, []);

  const handleGithubIntegrationFeedback = useCallback(
    (integration: ApiGithubIntegration, context: string) => {
      if (!integration) {
        return;
      }
      if (integration.status === "error") {
        notifyError(`${context}: ${integration.message || "GitHub webhook error."}`);
      } else if (integration.status === "skipped" && integration.message) {
        toast.info(integration.message);
      } else if (integration.status === "success" && integration.hookUrl) {
        toast.success("GitHub webhook synced.");
      }
    },
    [notifyError]
  );

  const refreshGithubStatus = useCallback(async () => {
    try {
      setLoadingGithubStatus(true);
      const status = await api.github.status();
      setGithubStatus((prev) => {
        if (!status.connected && prev?.connected) {
          return prev;
        }
        return status;
      });
    } catch (err) {
      console.warn("Failed to fetch GitHub status", err);
    } finally {
      setLoadingGithubStatus(false);
    }
  }, []);

  const loadGithubRepos = useCallback(
    async (options?: { force?: boolean; notifyIfDisconnected?: boolean; silent?: boolean }) => {
      const connected = githubStatus?.connected === true;
      if (!connected && !options?.force) {
        if (options?.notifyIfDisconnected) {
          toast.info("Connect GitHub to browse repositories.");
        }
        return;
      }
      setLoadingGithubRepos(true);
      try {
        const { repositories } = await api.github.repos({ force: options?.force });
        setGithubRepos(repositories);
      } catch (err) {
        if (!options?.silent) {
          notifyError(err instanceof Error ? err.message : "Failed to load GitHub repositories");
        }
      } finally {
        setLoadingGithubRepos(false);
      }
    },
    [githubStatus, notifyError]
  );

  const loadGithubRepoWebhooks = useCallback(
    async (options?: { silent?: boolean; perPage?: number; maxPages?: number; force?: boolean }) => {
      if (!isGithubConnected) {
        if (!options?.silent) {
          toast.info("Connect GitHub to inspect webhooks.");
        }
        return;
      }
      setGithubWebhooksLoading(true);
      try {
        const response = await api.github.webhooks({ perPage: options?.perPage, maxPages: options?.maxPages, force: options?.force });
        const map: Record<string, ApiGithubWebhook[]> = {};
        const errorsMap: Record<string, string> = {};
        response.repositories.forEach((item) => {
          map[item.repo] = item.webhooks;
          if (item.error) {
            errorsMap[item.repo] = item.error;
          }
        });
        setGithubWebhooksMap(map);
        setGithubWebhookErrors(errorsMap);
        setGithubWebhooksExhausted(Boolean(response.exhausted));
        setGithubWebhooksFetched(true);
      } catch (err) {
        if (!options?.silent) {
          notifyError(err instanceof Error ? err.message : "Failed to load GitHub webhooks");
        }
      } finally {
        setGithubWebhooksLoading(false);
      }
    },
    [isGithubConnected, notifyError]
  );

  const clearGithubPopupWatcher = useCallback(() => {
    if (githubPopupWatcherRef.current !== null) {
      window.clearInterval(githubPopupWatcherRef.current);
      githubPopupWatcherRef.current = null;
    }
  }, []);

  const handleConnectGithub = useCallback(async () => {
    setGithubConnecting(true);
    try {
      const { url } = await api.github.oauthUrl();
      const popup = window.open(url, "github-oauth", "width=720,height=720");
      if (!popup) {
        notifyError("Enable pop-ups to connect GitHub.");
        return;
      }
      githubPopupRef.current = popup;
      clearGithubPopupWatcher();
      githubPopupWatcherRef.current = window.setInterval(() => {
        if (!githubPopupRef.current || githubPopupRef.current.closed) {
          clearGithubPopupWatcher();
          githubPopupRef.current = null;
          void refreshGithubStatus();
          void loadGithubRepos({ force: true });
          void loadGithubRepoWebhooks({ silent: true, force: true });
        }
      }, 1000);
    } catch (err) {
      notifyError(err instanceof Error ? err.message : "Failed to start GitHub OAuth");
    } finally {
      setGithubConnecting(false);
    }
  }, [clearGithubPopupWatcher, loadGithubRepoWebhooks, loadGithubRepos, notifyError, refreshGithubStatus]);

  const handleDisconnectGithub = useCallback(async () => {
    setGithubDisconnecting(true);
    try {
      await api.github.disconnect();
      setGithubStatus({ connected: false });
      setGithubRepos([]);
      setGithubWebhooksMap({});
      setGithubWebhookErrors({});
      setGithubWebhooksFetched(false);
      setGithubWebhooksExhausted(false);
      notifySuccess("GitHub disconnected.");
    } catch (err) {
      notifyError(err instanceof Error ? err.message : "Failed to disconnect GitHub");
    } finally {
      setGithubDisconnecting(false);
    }
  }, [notifyError, notifySuccess]);

  const parseEventsCsv = (value: string): string[] => {
    if (!value || value === "*") {
      return ["*"];
    }
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  };

  const updateCreateEventsSelection = useCallback((nextSelection: string[]) => {
    const normalized = nextSelection.length === 0 ? ["*"] : Array.from(new Set(nextSelection));
    setCreateSelectedEvents(normalized);
    setNewSubscription((prev) => ({
      ...prev,
      events: normalized.includes("*") ? "*" : normalized.join(",")
    }));
  }, []);

  const handleCreateEventToggle = (eventName: string, checked: boolean) => {
    if (eventName === "*") {
      updateCreateEventsSelection(["*"]);
      return;
    }
    const withoutAll = createSelectedEvents.filter((item) => item !== "*");
    let next = withoutAll;
    if (checked) {
      if (!withoutAll.includes(eventName)) {
        next = [...withoutAll, eventName];
      }
    } else {
      next = withoutAll.filter((item) => item !== eventName);
    }
    updateCreateEventsSelection(next);
  };

  const updateEditEventsSelection = useCallback((nextSelection: string[]) => {
    const normalized = nextSelection.length === 0 ? ["*"] : Array.from(new Set(nextSelection));
    setEditSelectedEvents(normalized);
    setEditSubscription((prev) => ({
      ...prev,
      events: normalized.includes("*") ? "*" : normalized.join(",")
    }));
  }, []);

  const handleEditEventToggle = (eventName: string, checked: boolean) => {
    if (eventName === "*") {
      updateEditEventsSelection(["*"]);
      return;
    }
    const withoutAll = editSelectedEvents.filter((item) => item !== "*");
    let next = withoutAll;
    if (checked) {
      if (!withoutAll.includes(eventName)) {
        next = [...withoutAll, eventName];
      }
    } else {
      next = withoutAll.filter((item) => item !== eventName);
    }
    updateEditEventsSelection(next);
  };

  const eventsScrollRef = useRef(0);

  const stopChatLookupPolling = useCallback(() => {
    if (chatLookupPollRef.current !== null) {
      window.clearInterval(chatLookupPollRef.current);
      chatLookupPollRef.current = null;
    }
  }, []);

  const syncChatLookupSelection = useCallback((candidates: ApiChatLookupCandidate[]) => {
    setChatLookupSelectionKey((prev) => {
      if (candidates.length === 0) {
        return null;
      }
      if (prev && candidates.some((candidate) => getChatLookupCandidateKey(candidate) === prev)) {
        return prev;
      }
      return getChatLookupCandidateKey(candidates[0]);
    });
  }, []);

  const pollChatLookupStatus = useCallback(
    async (botIdOverride?: number) => {
      const targetBotId = botIdOverride ?? Number.parseInt(chatLookupBotId || "", 10);
      if (!targetBotId || Number.isNaN(targetBotId)) {
        return;
      }
      try {
        const status = await api.destinations.lookup.status(targetBotId);
        if (status.status === "ready") {
          let nextCandidates: ApiChatLookupCandidate[] = [];
          setChatLookupState((prev) => {
            const existing =
              prev.status === "pending" || prev.status === "ready" ? prev.chats : [];
            nextCandidates = normalizeChatLookupCandidates([...status.chats, ...existing]);
            const expiresAt =
              prev.status === "pending" || prev.status === "ready" ? prev.expiresAt : null;
            return { status: "ready", botId: targetBotId, chats: nextCandidates, expiresAt };
          });
          if (!chatLookupDetectedRef.current && nextCandidates.length > 0) {
            notifySuccess("Chat ID detected from Telegram.");
            chatLookupDetectedRef.current = true;
          }
          syncChatLookupSelection(nextCandidates);
          setChatLookupStopping(false);
        } else if (status.status === "pending") {
          let nextCandidates: ApiChatLookupCandidate[] = [];
          setChatLookupState((prev) => {
            const existing =
              prev.status === "pending" || prev.status === "ready" ? prev.chats : [];
            nextCandidates = normalizeChatLookupCandidates([...status.chats, ...existing]);
            const nextExpiresAt = status.expiresAt ?? null;
            if (prev.status === "pending") {
              return { ...prev, expiresAt: nextExpiresAt, chats: nextCandidates };
            }
            return {
              status: "pending",
              botId: targetBotId,
              chats: nextCandidates,
              expiresAt: nextExpiresAt
            };
          });
          syncChatLookupSelection(nextCandidates);
        } else if (status.status === "expired") {
          setChatLookupState({ status: "expired" });
          setChatLookupSelectionKey(null);
          stopChatLookupPolling();
          setChatLookupStopping(false);
        } else {
          setChatLookupState((prev) => (prev.status === "pending" ? { status: "idle" } : prev));
          setChatLookupSelectionKey(null);
          stopChatLookupPolling();
          setChatLookupStopping(false);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to check lookup status";
        setChatLookupState({ status: "error", message });
        setChatLookupSelectionKey(null);
        stopChatLookupPolling();
        setChatLookupStopping(false);
      }
    },
    [chatLookupBotId, notifySuccess, stopChatLookupPolling, syncChatLookupSelection, chatLookupDetectedRef]
  );

  const handleStartChatLookup = useCallback(async () => {
    if (!chatLookupBotId) {
      toast.info("Select a bot before detecting the chat ID.");
      return;
    }
    if (chatLookupState.status === "pending") {
      toast.info("Detection already in progress. Stop it first if you need to restart.");
      return;
    }
    const numericBotId = Number.parseInt(chatLookupBotId, 10);
    if (Number.isNaN(numericBotId)) {
      toast.error("Invalid bot selection.");
      return;
    }
    setChatLookupLoading(true);
    setChatLookupStopping(false);
    setChatLookupSelectionKey(null);
    chatLookupDetectedRef.current = false;
    try {
      const response = await api.destinations.lookup.start({ botId: numericBotId });
      setChatLookupState({
        status: "pending",
        botId: numericBotId,
        chats: [],
        expiresAt: response.expiresAt ?? null
      });
      stopChatLookupPolling();
      chatLookupPollRef.current = window.setInterval(() => {
        void pollChatLookupStatus(numericBotId);
      }, 2000);
      await pollChatLookupStatus(numericBotId);
    } catch (err) {
      setChatLookupState({
        status: "error",
        message: err instanceof Error ? err.message : "Failed to start chat lookup"
      });
      setChatLookupSelectionKey(null);
      stopChatLookupPolling();
    } finally {
      setChatLookupLoading(false);
    }
  }, [chatLookupBotId, chatLookupState.status, pollChatLookupStatus, stopChatLookupPolling]);

  const handleStopChatLookup = useCallback(
    async (options?: { clear?: boolean }) => {
      if (!chatLookupBotId) {
        if (options?.clear) {
          setChatLookupState({ status: "idle" });
          setChatLookupSelectionKey(null);
        }
        return;
      }
      const numericBotId = Number.parseInt(chatLookupBotId, 10);
      if (Number.isNaN(numericBotId)) {
        if (options?.clear) {
          setChatLookupState({ status: "idle" });
          setChatLookupSelectionKey(null);
        }
        return;
      }
      setChatLookupStopping(true);
      stopChatLookupPolling();
      try {
        await api.destinations.lookup.reset({ botId: numericBotId });
      } catch (error) {
        console.warn("Failed to stop chat lookup", error);
      } finally {
        setChatLookupStopping(false);
        setChatLookupLoading(false);
        let nextCandidates: ApiChatLookupCandidate[] = [];
        setChatLookupState((prev) => {
          if (options?.clear) {
            nextCandidates = [];
            return { status: "idle" };
          }
          if (prev.status === "pending" || prev.status === "ready") {
            nextCandidates = prev.chats;
            if (prev.chats.length === 0) {
              return { status: "idle" };
            }
            return { status: "ready", botId: prev.botId, chats: prev.chats, expiresAt: prev.expiresAt ?? null };
          }
          nextCandidates = [];
          return prev;
        });
        if (options?.clear || nextCandidates.length === 0) {
          setChatLookupSelectionKey(null);
        } else {
          syncChatLookupSelection(nextCandidates);
        }
      }
    },
    [chatLookupBotId, stopChatLookupPolling, syncChatLookupSelection]
  );

  const handleResetChatLookup = useCallback(async () => {
    await handleStopChatLookup({ clear: true });
  }, [handleStopChatLookup]);

  const EventsSelector = ({
    selected,
    onToggle,
    onSelectAll
  }: {
    selected: string[];
    onToggle: (eventName: string, checked: boolean) => void;
    onSelectAll: () => void;
  }) => {
    const listRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
      const node = listRef.current;
      if (!node) {
        return;
      }
      node.scrollTop = eventsScrollRef.current;
    }, [selected]);

    const handleScroll = (event: UIEvent<HTMLDivElement>) => {
      eventsScrollRef.current = event.currentTarget.scrollTop;
    };

    return (
      <div className="rounded-2xl border border-slate-800/70 bg-slate-950/40 p-3">
      <label className="flex items-center gap-2 rounded-xl border border-slate-800/60 bg-slate-900/50 px-3 py-2 text-sm text-slate-200">
        <input
          type="checkbox"
          className="h-4 w-4 rounded border-slate-700 bg-slate-900 accent-sky-400"
          checked={selected.includes("*")}
          onChange={() => onSelectAll()}
        />
        <span className="font-semibold">All events (*)</span>
      </label>
      <div
        ref={listRef}
        onScroll={handleScroll}
        className="mt-3 max-h-[420px] space-y-2 overflow-y-auto pr-2"
        style={{ scrollbarGutter: "stable both-edges" }}
      >
        {eventsOptions.length > 0 ? (
          eventsOptions.map((event) => {
            const checked = !selected.includes("*") && selected.includes(event);
            return (
              <label
                key={event}
                className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-slate-200 transition hover:bg-slate-900/40"
              >
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-slate-700 bg-slate-900 accent-sky-400"
                  checked={checked}
                  onChange={(e) => onToggle(event, e.target.checked)}
                />
                <span className="capitalize">{event.replace(/_/g, " ")}</span>
              </label>
            );
          })
        ) : (
          <p className="text-xs text-slate-400">Loading events…</p>
        )}
      </div>
    </div>
    );
  };

  const GithubRepoBrowser = ({ value, onSelect }: { value: string; onSelect: (repoFullName: string) => void }) => {
    const [open, setOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement | null>(null);
    const selected = githubRepos.find((repo) => repo.fullName === value) ?? null;
    const repoKey = selected?.fullName ?? value;
    const repoHooks = repoKey ? githubWebhooksMap[repoKey] : undefined;
    const repoHookError = repoKey ? githubWebhookErrors[repoKey] : undefined;

    useEffect(() => {
      if (!open) {
        return;
      }
      const listener = (event: MouseEvent) => {
        if (!containerRef.current || containerRef.current.contains(event.target as Node)) {
          return;
        }
        setOpen(false);
      };
      document.addEventListener("mousedown", listener);
      return () => document.removeEventListener("mousedown", listener);
    }, [open]);

    if (loadingGithubStatus && !isGithubConnected) {
      return (
        <div className="rounded-2xl border border-slate-800/60 bg-slate-950/50 p-4 text-xs text-slate-400">
          Checking GitHub connection…
        </div>
      );
    }

    if (!isGithubConnected) {
      return (
        <div className="space-y-2 rounded-2xl border border-slate-800/60 bg-slate-950/50 p-4 text-xs text-slate-400">
          <p>Connect GitHub to browse and select repositories automatically.</p>
          <Button size="sm" onClick={handleConnectGithub} disabled={githubConnecting || loadingGithubStatus}>
            {githubConnecting ? "Opening…" : "Connect GitHub"}
          </Button>
        </div>
      );
    }

    return (
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
          <span className="font-medium text-slate-300">
            Connected as {githubAccountUsername ? `@${githubAccountUsername}` : "GitHub user"}
          </span>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void loadGithubRepos({ notifyIfDisconnected: true, force: true })}
            disabled={loadingGithubRepos}
          >
            {loadingGithubRepos && <Spinner className="mr-2 h-4 w-4" />} Refresh repos
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void loadGithubRepoWebhooks({ force: true })}
            disabled={githubWebhooksLoading}
          >
            {githubWebhooksLoading && <Spinner className="mr-2 h-4 w-4" />} Sync webhooks
          </Button>
          <Button variant="ghost" size="sm" onClick={handleDisconnectGithub} disabled={githubDisconnecting}>
            {githubDisconnecting ? "Disconnecting…" : "Disconnect"}
          </Button>
        </div>
        <div ref={containerRef} className="relative">
          <Button
            variant="outline"
            type="button"
            role="combobox"
            aria-expanded={open}
            onClick={() => {
              setOpen((prev) => {
                const next = !prev;
                if (next) {
                  if (githubRepos.length === 0 && !loadingGithubRepos) {
                    void loadGithubRepos({ silent: true });
                  }
                  if (!githubWebhooksFetched && !githubWebhooksLoading) {
                    void loadGithubRepoWebhooks({ silent: true });
                  }
                }
                return next;
              });
            }}
            className={cn(
              "w-full justify-between border-slate-800/70 bg-slate-950/60 text-left text-sm font-medium text-slate-200",
              selected ? "" : "text-slate-500"
            )}
          >
            <span className="flex min-w-0 flex-col">
              {selected ? (
                <>
                  <span className="truncate text-sm text-slate-100">{selected.fullName}</span>
                  <span className="truncate text-xs text-slate-500">
                    {selected.description || (selected.private ? "Private" : "Public repository")}
                  </span>
                </>
              ) : (
                "Select repository"
              )}
            </span>
            {loadingGithubRepos ? (
              <Loader2 className="ml-2 h-4 w-4 animate-spin text-slate-400" />
            ) : (
              <ChevronsUpDown className="ml-2 h-4 w-4 text-slate-500" />
            )}
          </Button>
          {open ? (
            <div className="absolute left-0 right-0 top-full z-50 mt-2 max-h-64 overflow-hidden rounded-xl border border-slate-800/70 bg-slate-950/95 text-slate-100 shadow-xl shadow-slate-950/40">
              <Command className="border-none">
                <CommandInput placeholder="Search repository…" className="px-3" />
                <CommandList className="max-h-56 overflow-y-auto">
                  <CommandEmpty>
                    {loadingGithubRepos ? (
                      <span className="flex items-center justify-center gap-2 text-slate-400">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Loading repositories…
                      </span>
                    ) : (
                      "No repository found."
                    )}
                  </CommandEmpty>
                <CommandGroup heading="Repositories" className="mt-1 space-y-1">
                  {githubRepos.map((repo) => (
                    <CommandItem
                      key={repo.fullName}
                      value={repo.fullName}
                      onSelect={(currentValue) => {
                          onSelect(currentValue);
                          setOpen(false);
                        }}
                      >
                        <Check
                          className={cn(
                            "h-4 w-4 text-sky-400",
                            repo.fullName === value ? "opacity-100" : "opacity-0"
                          )}
                        />
                        <div className="flex flex-col gap-0.5">
                          <span className="text-sm font-medium text-slate-100">{repo.fullName}</span>
                          {repo.description && <span className="text-xs text-slate-400">{repo.description}</span>}
                          <span className="text-xs text-slate-500">{repo.private ? "Private" : "Public"}</span>
                        </div>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </div>
          ) : null}
        </div>
        <div className="mt-3 space-y-3">
          <div className="flex items-center justify-between text-[11px] text-slate-400">
            <span>Webhooks detected{repoKey ? ` · ${repoHooks?.length ?? 0}` : ""}</span>
            {githubWebhooksExhausted && (
              <span className="text-amber-300">Partial list (page limit)</span>
            )}
          </div>
          <div className="max-h-[315px] space-y-3 overflow-y-auto pr-1" style={{ scrollbarGutter: "stable" }}>
            {githubWebhooksLoading && !repoHooks ? (
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <Loader2 className="h-4 w-4 animate-spin" />
                Syncing webhooks…
              </div>
          ) : repoHookError ? (
            <div className="text-xs text-red-300">{repoHookError}</div>
          ) : repoKey ? (
            repoHooks && repoHooks.length > 0 ? (
              <div className="space-y-3">
                {repoHooks.map((hook) => (
                  <div
                    key={`${repoKey}-${hook.id || hook.url}`}
                    className="rounded-xl border border-slate-800/60 bg-slate-950/70 p-3 text-xs text-slate-300"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium text-slate-100">{hook.url || "(no URL)"}</span>
                      <Badge variant={hook.authorized ? "emerald" : "destructive"} className="text-[10px] uppercase tracking-wide">
                        {hook.authorized ? "Authorized" : "Unauthorized"}
                      </Badge>
                    </div>
                    <TooltipProvider delayDuration={150}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-400">
                            <span className="truncate">
                              {hook.events.length > 0 ? hook.events.slice(0, 3).join(", ") : "No events"}
                              {hook.events.length > 3 ? ` (+${hook.events.length - 3})` : ""}
                            </span>
                            <span>•</span>
                            <span>{hook.active ? "Active" : "Inactive"}</span>
                            {hook.subscriptionHookId && (
                              <>
                                <span>•</span>
                                <span>Subscription {hook.subscriptionHookId}</span>
                              </>
                            )}
                          </div>
                        </TooltipTrigger>
                        {hook.events.length > 3 && (
                          <TooltipContent>
                            <div className="max-w-xs text-left text-[11px] leading-relaxed text-slate-100">
                              <p className="font-semibold text-slate-200">Subscribed events</p>
                              <p>{hook.events.join(", ")}</p>
                            </div>
                          </TooltipContent>
                        )}
                      </Tooltip>
                    </TooltipProvider>
                    {hook.createdAt && (
                      <div className="mt-1 text-[10px] text-slate-500">Created {hook.createdAt}</div>
                    )}
                  </div>
                ))}
              </div>
            ) : githubWebhooksLoading ? (
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading webhooks…
              </div>
            ) : (
              <div className="text-xs text-slate-500">No webhooks detected for this repository.</div>
            )
          ) : (
            <div className="text-xs text-slate-500">Select a repository to inspect existing webhooks.</div>
          )}
          </div>
        </div>
      </div>
    );
  };

  useEffect(() => {
    const load = async () => {
      try {
        await api.me();
        const [botsRes, destRes, subsRes] = await Promise.all([
          api.bots.list(),
          api.destinations.list(),
          api.subscriptions.list()
        ]);
        setBots(botsRes.bots);
        setDestinations(destRes.destinations);
        setSubscriptions(subsRes.subscriptions);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          router.replace("/login");
          return;
        }
        notifyError(err instanceof Error ? err.message : "Failed to load dashboard");
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [router, notifyError]);

  useEffect(() => {
    void refreshGithubStatus();
  }, [refreshGithubStatus]);

  useEffect(() => {
    const fetchEvents = async () => {
      try {
        const response = await api.events.list();
        setEventsOptions(response.events);
      } catch (err) {
        console.warn("Failed to fetch GitHub events list", err);
        setEventsOptions(["push", "pull_request", "issues", "release", "workflow_run", "ping"]);
      }
    };
    fetchEvents();
  }, []);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => () => stopChatLookupPolling(), [stopChatLookupPolling]);

  useEffect(() => {
    if (!chatLookupBotId) {
      setChatLookupSelectionKey(null);
      setChatLookupState({ status: "idle" });
      return;
    }
    if (prevChatLookupBotId.current && prevChatLookupBotId.current !== chatLookupBotId) {
      stopChatLookupPolling();
      setChatLookupState({ status: "idle" });
      setChatLookupSelectionKey(null);
      setChatLookupLoading(false);
      setChatLookupStopping(false);
    }
    prevChatLookupBotId.current = chatLookupBotId;
  }, [chatLookupBotId, stopChatLookupPolling]);

  useEffect(() => {
    if (!chatLookupSelectionKey) {
      return;
    }
    if (chatLookupState.status !== "pending" && chatLookupState.status !== "ready") {
      return;
    }
    const match = chatLookupState.chats.find(
      (candidate) => getChatLookupCandidateKey(candidate) === chatLookupSelectionKey
    );
    if (!match) {
      return;
    }
    setNewDestination((prev) => {
      const next = {
        ...prev,
        chatId: match.chatId,
        title: prev.title || match.title || "",
        topicId: match.topicId ? String(match.topicId) : prev.topicId
      };
      if (prev.chatId === next.chatId && prev.title === next.title && prev.topicId === next.topicId) {
        return prev;
      }
      return next;
    });
  }, [chatLookupSelectionKey, chatLookupState]);

  useEffect(() => {
    if (!isGithubConnected) {
      setGithubRepos([]);
      setGithubWebhooksMap({});
      setGithubWebhookErrors({});
      setGithubWebhooksFetched(false);
      setGithubWebhooksExhausted(false);
      return;
    }
    if (githubRepos.length === 0 && !loadingGithubRepos) {
      void loadGithubRepos({ silent: true });
    }
  }, [isGithubConnected, githubRepos.length, loadGithubRepos, loadingGithubRepos]);

  useEffect(() => {
    if (!isGithubConnected) {
      return;
    }
    if (!githubWebhooksFetched && !githubWebhooksLoading) {
      void loadGithubRepoWebhooks({ silent: true });
    }
  }, [isGithubConnected, githubWebhooksFetched, githubWebhooksLoading, loadGithubRepoWebhooks]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (!event || typeof event.data !== "object" || event.data === null) {
        return;
      }
      if (apiOrigin && event.origin !== apiOrigin) {
        return;
      }
      const payload = event.data as GithubOAuthMessage;
      if (payload.source !== "github-oauth") {
        return;
      }
      if (githubPopupRef.current && !githubPopupRef.current.closed) {
        githubPopupRef.current.close();
      }
      clearGithubPopupWatcher();
      if (payload.status === "success") {
        toast.success(payload.message || "GitHub connected.");
        const placeholderAccount = githubStatus?.connected
          ? githubStatus.account
          : {
              username: payload.username || githubAccountUsername || null,
              avatarUrl: null,
              scopes: [] as string[],
              updatedAt: new Date().toISOString()
            };
        setGithubStatus({ connected: true, account: placeholderAccount });
        void refreshGithubStatus();
        void loadGithubRepos({ force: true });
        void loadGithubRepoWebhooks({ silent: true, force: true });
      } else {
        notifyError(payload.message || "GitHub connection failed.");
      }
    };
    window.addEventListener("message", handleMessage);
    return () => {
      window.removeEventListener("message", handleMessage);
      clearGithubPopupWatcher();
    };
  }, [apiOrigin, clearGithubPopupWatcher, githubAccountUsername, githubStatus, loadGithubRepoWebhooks, loadGithubRepos, notifyError, refreshGithubStatus]);

  useEffect(() => {
    if (!eventsOptions.length) {
      return;
    }
    if (!createSelectedEvents.includes("*")) {
      const filteredCreate = createSelectedEvents.filter((event) => eventsOptions.includes(event));
      if (filteredCreate.length !== createSelectedEvents.length) {
        updateCreateEventsSelection(filteredCreate);
      }
    }
    if (!editSelectedEvents.includes("*")) {
      const filteredEdit = editSelectedEvents.filter((event) => eventsOptions.includes(event));
      if (filteredEdit.length !== editSelectedEvents.length) {
        updateEditEventsSelection(filteredEdit);
      }
    }
  }, [createSelectedEvents, editSelectedEvents, eventsOptions, updateCreateEventsSelection, updateEditEventsSelection]);

  const stats = useMemo<DashboardMetric[]>(
    () => [
      {
        label: "Bots",
        value: bots.length,
        hint: "Connected Telegram bots ready to deliver notifications.",
        icon: Bot,
        accent: "border-sky-500/40 bg-sky-500/10 text-sky-100"
      },
      {
        label: "Destinations",
        value: destinations.length,
        hint: "Chats, channels, or topics currently linked to bots.",
        icon: MapPin,
        accent: "border-emerald-500/40 bg-emerald-500/10 text-emerald-100"
      },
      {
        label: "Subscriptions",
        value: subscriptions.length,
        hint: "Repositories with GitHub webhooks pointing to this bridge.",
        icon: GitBranch,
        accent: "border-violet-500/40 bg-violet-500/10 text-violet-100"
      }
    ],
    [bots.length, destinations.length, subscriptions.length]
  );

  const botOptions = useMemo(
    () =>
      bots.map((bot) => ({
        value: String(bot.id),
        label: bot.displayName || bot.botId
      })),
    [bots]
  );

  useEffect(() => {
    if (!chatLookupBotId && botOptions.length > 0) {
      setChatLookupBotId(botOptions[0].value);
      prevChatLookupBotId.current = botOptions[0].value;
    }
  }, [botOptions, chatLookupBotId]);

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
        isDefault: dest.isDefault
      })),
    [destinations]
  );

  const destinationLabelMap = useMemo(() => {
    const map = new Map<number, string>();
    destinations.forEach((dest) => map.set(dest.id, dest.title ? `${dest.title} (${dest.chatId})` : dest.chatId));
    return map;
  }, [destinations]);

  const chatLookupCandidates = useMemo(() => {
    if (chatLookupState.status === "pending" || chatLookupState.status === "ready") {
      return chatLookupState.chats;
    }
    return [];
  }, [chatLookupState]);

  const isChatLookupPending = chatLookupState.status === "pending";
  const isChatLookupReady = chatLookupState.status === "ready";
  const canResetChatLookup =
    chatLookupState.status === "pending" ||
    chatLookupState.status === "ready" ||
    chatLookupState.status === "expired" ||
    chatLookupState.status === "error";
  const showStopChatLookup = isChatLookupPending || isChatLookupReady;

  const botIsInUse = useCallback(
    (botId: number) => subscriptions.some((subscription) => subscription.botId === botId),
    [subscriptions]
  );

  const destinationIsInUse = useCallback(
    (destinationId: number) => subscriptions.some((subscription) => subscription.destinationId === destinationId),
    [subscriptions]
  );

  const isSavingEdit = editingSubscriptionId !== null && busyAction === `update-subscription-${editingSubscriptionId}`;
  const isEditFormIncomplete = !editSubscription.repo.trim() || !editSubscription.botId || !editSubscription.destinationId;

  const setBotWebhookDetails = (id: number, info: ApiWebhookInfo) => {
    setBotDetails((prev) => ({ ...prev, [id]: { webhookInfo: info } }));
  };

  const handleAddBot = async () => {
    setBusyAction("add-bot");
    try {
      const response = await api.bots.create({ token: newToken, dropPendingUpdates: dropPendingUpdatesOnCreate });
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
      setBots((prev) => prev.map((bot) => (bot.id === id ? { ...bot, displayName: response.bot.displayName, token: response.bot.token } : bot)));
      setBotWebhookDetails(id, response.webhookInfo);
    } catch (err) {
      notifyError(err instanceof Error ? err.message : "Failed to fetch webhook info");
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
      const response = await api.bots.updateToken(id, { token: rotateTokenValue.trim() });
      setBots((prev) =>
        prev.map((bot) =>
          bot.id === id
            ? {
                ...bot,
                token: rotateTokenValue.trim(),
                displayName: response.displayName || bot.displayName
              }
            : bot
        )
      );
      setBotWebhookDetails(id, response.webhookInfo);
      setRotatingBotId(null);
      setRotateTokenValue("");
      notifySuccess("Bot token updated.");
    } catch (err) {
      notifyError(err instanceof Error ? err.message : "Failed to update token");
    } finally {
      setBusyAction(null);
    }
  };

  const handleRemoveBot = async (id: number) => {
    if (botIsInUse(id)) {
      notifyError("Remove subscriptions linked to this bot before deleting it.");
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
        notifyError("Remove subscriptions linked to this bot before deleting it.");
      } else {
        notifyError(err instanceof Error ? err.message : "Failed to remove bot");
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
      notifyError(err instanceof Error ? err.message : "Failed to drop pending updates");
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
        isDefault: newDestination.isDefault
      };
      if (newDestination.title.trim()) {
        payload.title = newDestination.title.trim();
      }
      if (newDestination.topicId.trim()) {
        payload.topicId = newDestination.topicId.trim();
      }
      const response = await api.destinations.create(payload);
      setDestinations((prev) => {
        const updated = newDestination.isDefault ? prev.map((d) => ({ ...d, isDefault: false })) : prev;
        return [response.destination, ...updated];
      });
      setNewDestination({ chatId: "", title: "", topicId: "", isDefault: false });
      notifySuccess("Destination added.");
    } catch (err) {
      notifyError(err instanceof Error ? err.message : "Failed to add destination");
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
      isDefault: destination.isDefault
    });
  };

  const cancelEditDestination = () => {
    setEditingDestinationId(null);
    setDestinationForm({ chatId: "", title: "", topicId: "", isDefault: false });
  };

  const saveDestination = async (id: number) => {
    setBusyAction(`update-destination-${id}`);
    try {
      await api.destinations.update(id, {
        chatId: destinationForm.chatId,
        title: destinationForm.title,
        topicId: destinationForm.topicId === "" ? null : destinationForm.topicId,
        isDefault: destinationForm.isDefault
      });
      setDestinations((prev) =>
        prev.map((dest) => {
          if (dest.id !== id) {
            return destinationForm.isDefault ? { ...dest, isDefault: false } : dest;
          }
          return {
            ...dest,
            chatId: destinationForm.chatId,
            title: destinationForm.title,
            topicId: destinationForm.topicId === "" ? null : Number(destinationForm.topicId),
            isDefault: destinationForm.isDefault
          };
        })
      );
      cancelEditDestination();
      notifySuccess("Destination updated.");
    } catch (err) {
      notifyError(err instanceof Error ? err.message : "Failed to update destination");
    } finally {
      setBusyAction(null);
    }
  };

  const handleSetDefaultDestination = async (id: number) => {
    setBusyAction(`default-destination-${id}`);
    try {
      await api.destinations.setDefault(id);
      setDestinations((prev) => prev.map((dest) => ({ ...dest, isDefault: dest.id === id })));
      notifySuccess("Default destination updated.");
    } catch (err) {
      notifyError(err instanceof Error ? err.message : "Failed to set default destination");
    } finally {
      setBusyAction(null);
    }
  };

  const handleRemoveDestination = async (id: number) => {
    if (destinationIsInUse(id)) {
      notifyError("Remove subscriptions linked to this destination before deleting it.");
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
        notifyError("Remove subscriptions linked to this destination before deleting it.");
      } else {
        notifyError(err instanceof Error ? err.message : "Failed to remove destination");
      }
    } finally {
      setBusyAction(null);
    }
  };

  const startEditSubscription = (subscription: ApiSubscription) => {
    setEditingSubscriptionId(subscription.id);
    setEditSubscription({
      repo: subscription.repo,
      botId: String(subscription.botId),
      destinationId: String(subscription.destinationId),
      events: subscription.eventsCsv
    });
    updateEditEventsSelection(parseEventsCsv(subscription.eventsCsv));
    setIsEditDialogOpen(true);
  };

  const cancelEditSubscription = useCallback(() => {
    setIsEditDialogOpen(false);
    setEditingSubscriptionId(null);
    setEditSubscription({ repo: "", botId: "", destinationId: "", events: "*" });
    updateEditEventsSelection(["*"]);
  }, [updateEditEventsSelection]);

  useEffect(() => {
    if (!isEditDialogOpen || typeof document === "undefined") {
      return undefined;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        cancelEditSubscription();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [isEditDialogOpen, cancelEditSubscription]);

  const handleSubmitSubscription = async () => {
    const repo = newSubscription.repo.trim();
    if (!repo || !newSubscription.botId || !newSubscription.destinationId) {
      notifyError("Repository, bot, and destination are required.");
      return;
    }
    const botId = Number.parseInt(newSubscription.botId, 10);
    const destinationId = Number.parseInt(newSubscription.destinationId, 10);
    const eventsValue = createSelectedEvents.includes("*") ? "*" : createSelectedEvents.join(",");

    setBusyAction("add-subscription");
    try {
      const response = await api.subscriptions.create({
        repo,
        events: eventsValue,
        botId,
        destinationId
      });
      if (response.subscription) {
        setSubscriptions((prev) => [response.subscription as ApiSubscription, ...prev]);
        setLatestWebhook({
          repo: response.subscription.repo,
          payloadUrl: response.webhook.payloadUrl,
          secret: response.webhook.secret,
          events: response.webhook.events,
          contentType: response.webhook.contentType ?? "application/json",
          botLabel: botLabelMap.get(botId) ?? String(botId),
          destinationLabel: destinationLabelMap.get(destinationId) ?? String(destinationId)
        });
      }
      setNewSubscription({ repo: "", events: "*", botId: "", destinationId: "" });
      updateCreateEventsSelection(["*"]);
      notifySuccess("Subscription created.");
      handleGithubIntegrationFeedback(response.githubIntegration, "GitHub webhook creation");
    } catch (err) {
      notifyError(err instanceof Error ? err.message : "Failed to add subscription");
    } finally {
      setBusyAction(null);
    }
  };

  const handleSaveEditSubscription = async () => {
    if (editingSubscriptionId === null) {
      return;
    }
    const repo = editSubscription.repo.trim();
    if (!repo || !editSubscription.botId || !editSubscription.destinationId) {
      notifyError("Repository, bot, and destination are required.");
      return;
    }
    const botId = Number.parseInt(editSubscription.botId, 10);
    const destinationId = Number.parseInt(editSubscription.destinationId, 10);
    const eventsValue = editSelectedEvents.includes("*") ? "*" : editSelectedEvents.join(",");
    setBusyAction(`update-subscription-${editingSubscriptionId}`);
    try {
      const response = await api.subscriptions.update(editingSubscriptionId, {
        repo,
        events: eventsValue,
        botId,
        destinationId
      });
      if (response.subscription) {
        setSubscriptions((prev) =>
          prev.map((sub) => (sub.id === editingSubscriptionId ? (response.subscription as ApiSubscription) : sub))
        );
      } else {
        setSubscriptions((prev) =>
          prev.map((sub) =>
            sub.id === editingSubscriptionId
              ? { ...sub, repo, eventsCsv: eventsValue, botId, destinationId }
              : sub
          )
        );
      }
      cancelEditSubscription();
      notifySuccess("Subscription updated.");
      handleGithubIntegrationFeedback(response.githubIntegration, "GitHub webhook update");
    } catch (err) {
      notifyError(err instanceof Error ? err.message : "Failed to update subscription");
    } finally {
      setBusyAction(null);
    }
  };

  const handleRemoveSubscription = async (id: number) => {
    setBusyAction(`delete-subscription-${id}`);
    try {
      const response = await api.subscriptions.remove(id);
      setSubscriptions((prev) => prev.filter((sub) => sub.id !== id));
      notifySuccess("Subscription removed.");
      handleGithubIntegrationFeedback(response.githubIntegration, "GitHub webhook removal");
    } catch (err) {
      notifyError(err instanceof Error ? err.message : "Failed to remove subscription");
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
    if (element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement) {
      element.focus({ preventScroll: true });
    }
  }, []);

  const jumpToBots = useCallback(() => scrollToElement("bot-token"), [scrollToElement]);
  const jumpToDestinations = useCallback(() => scrollToElement("dest-chat"), [scrollToElement]);
  const jumpToSubscriptions = useCallback(() => scrollToElement("subscription-repo"), [scrollToElement]);

  const quickActions = useMemo<QuickAction[]>(
    () => [
      {
        label: "Register a bot",
        description: "Store the BotFather token securely and refresh the Telegram webhook automatically.",
        onClick: jumpToBots,
        icon: Bot,
        accent: "border-sky-500/40 bg-sky-500/10 text-sky-100",
        badge: "Step 1"
      },
      {
        label: "Add a destination",
        description: "Connect chats, channels, or topics so each team receives the right updates.",
        onClick: jumpToDestinations,
        icon: Send,
        accent: "border-emerald-500/40 bg-emerald-500/10 text-emerald-100",
        badge: "Step 2"
      },
      {
        label: "Create a subscription",
        description: "Generate GitHub webhook URLs and secrets for the repos that matter.",
        onClick: jumpToSubscriptions,
        icon: Workflow,
        accent: "border-violet-500/40 bg-violet-500/10 text-violet-100",
        badge: "Step 3"
      }
    ],
    [jumpToBots, jumpToDestinations, jumpToSubscriptions]
  );

  const editDialog = isMounted && isEditDialogOpen && editingSubscriptionId !== null
    ? createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur"
          onClick={cancelEditSubscription}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="edit-subscription-title"
            className="relative w-full max-w-2xl space-y-6 rounded-3xl border border-slate-800/80 bg-slate-950/90 p-6 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 id="edit-subscription-title" className="text-xl font-semibold text-slate-50">
                  Edit subscription
                </h2>
                <p className="text-sm text-slate-400">
                  Subscription #{editingSubscriptionId} · {editSubscription.repo || "owner/repo"}
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={cancelEditSubscription} disabled={isSavingEdit}>
                Close
              </Button>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="edit-subscription-repo">Repository</Label>
                <Input
                  id="edit-subscription-repo"
                  placeholder="owner/repo"
                  value={editSubscription.repo}
                  onChange={(event) => setEditSubscription((prev) => ({ ...prev, repo: event.target.value }))}
                />
                <GithubRepoBrowser
                  value={editSubscription.repo}
                  onSelect={(repoFullName) => setEditSubscription((prev) => ({ ...prev, repo: repoFullName }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-subscription-events">Events</Label>
                <div id="edit-subscription-events">
                  <EventsSelector
                    selected={editSelectedEvents}
                    onToggle={handleEditEventToggle}
                    onSelectAll={() => updateEditEventsSelection(["*"])}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-subscription-bot">Bot</Label>
                <select
                  id="edit-subscription-bot"
                  className={selectClass}
                  value={editSubscription.botId}
                  onChange={(event) => setEditSubscription((prev) => ({ ...prev, botId: event.target.value }))}
                >
                  <option value="">Select bot</option>
                  {botOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-subscription-dest">Destination</Label>
                <select
                  id="edit-subscription-dest"
                  className={selectClass}
                  value={editSubscription.destinationId}
                  onChange={(event) => setEditSubscription((prev) => ({ ...prev, destinationId: event.target.value }))}
                >
                  <option value="">Select destination</option>
                  {destinationOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex flex-col gap-3 pt-2 sm:flex-row sm:justify-end">
              <Button variant="ghost" onClick={cancelEditSubscription} disabled={isSavingEdit}>
                Cancel
              </Button>
              <Button onClick={handleSaveEditSubscription} disabled={isSavingEdit || isEditFormIncomplete}>
                {isSavingEdit ? "Saving…" : "Save changes"}
              </Button>
            </div>
          </div>
        </div>,
        document.body
      )
    : null;

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
    <>
      {editDialog}
      <div className="relative min-h-screen bg-slate-950 text-slate-50">
        <div className="pointer-events-none absolute inset-0 z-10 opacity-70 mix-blend-soft-light bg-[radial-gradient(circle_at_15%_20%,rgba(56,189,248,0.3),rgba(15,23,42,0.88)55%,rgba(2,6,23,1))]" />
        <div className="relative z-10 mx-auto flex w-full max-w-7xl flex-col gap-8 px-6 pb-16 pt-12 lg:px-16">
          <Card className="relative overflow-hidden border border-slate-800/60 bg-slate-950/80">
            <div className="pointer-events-none absolute -top-24 right-4 h-48 w-48 rounded-full bg-sky-500/15 blur-3xl" />
            <div className="pointer-events-none absolute -bottom-28 left-0 h-48 w-48 rounded-full bg-violet-500/15 blur-3xl" />
            <CardHeader className="relative flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <Badge variant="emerald" className="flex items-center gap-1 rounded-full border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-emerald-100">
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
                  Monitor every integration, onboard new destinations, and keep delivery flowing without leaving this screen.
                </CardDescription>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="ghost" size="sm" onClick={() => router.push("/stats")}>
                  Open stats
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    await api.auth.logout();
                    router.replace("/login");
                  }}
                >
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
                      className="group relative flex h-full flex-col justify-between rounded-2xl border border-slate-800/70 bg-slate-900/60 p-4 text-left transition hover:border-sky-500/40 hover:bg-slate-900/80"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div
                          className={cn(
                            "flex h-11 w-11 items-center justify-center rounded-xl border text-slate-100 shadow-inner shadow-black/40 transition group-hover:scale-105",
                            action.accent
                          )}
                        >
                          <Icon className="h-5 w-5" />
                        </div>
                        <Badge variant="default" className="border-transparent bg-slate-900/40 text-[10px] uppercase tracking-wide text-slate-300">
                          {action.badge}
                        </Badge>
                      </div>
                      <div className="mt-4 space-y-2">
                        <p className="text-sm font-semibold text-slate-100">{action.label}</p>
                        <p className="text-xs text-slate-400">{action.description}</p>
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
                  className="relative overflow-hidden border border-slate-800/60 bg-slate-950/75 transition hover:border-slate-700 hover:bg-slate-900/70"
                >
                  <CardContent className="flex flex-col gap-4 p-5">
                    <div className="flex items-start justify-between gap-4">
                      <div className="space-y-2">
                        <p className="text-xs uppercase tracking-wide text-slate-400">{item.label}</p>
                        <p className="text-3xl font-semibold text-slate-50">{item.value.toLocaleString()}</p>
                      </div>
                      <div
                        className={cn(
                          "flex h-11 w-11 items-center justify-center rounded-xl border text-slate-100 shadow-inner shadow-black/30",
                          item.accent
                        )}
                      >
                        <Icon className="h-5 w-5" />
                      </div>
                    </div>
                    <p className="text-xs text-slate-500">{item.hint}</p>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Bots section */}
          <Card className="border-slate-800/60 bg-slate-950/75" id="bots-section">
            <CardHeader>
              <CardTitle>Telegram bots</CardTitle>
              <CardDescription>Tokens stay encrypted at rest and webhooks are refreshed instantly after every update.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-2 rounded-2xl border border-slate-800/70 bg-slate-900/60 p-4">
                <Label htmlFor="bot-token">Bot token</Label>
                <Input
                  id="bot-token"
                  placeholder="123456789:AA..."
                  value={newToken}
                  onChange={(event) => setNewToken(event.target.value)}
                />
                <label className="flex items-center gap-2 text-xs text-slate-400">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-slate-700 bg-slate-900 accent-sky-400"
                    checked={dropPendingUpdatesOnCreate}
                    onChange={(event) => setDropPendingUpdatesOnCreate(event.target.checked)}
                  />
                  Drop pending updates after registering
                </label>
                <Button onClick={handleAddBot} disabled={!newToken || busyAction === "add-bot"}>
                  {busyAction === "add-bot" ? "Adding…" : "Add bot"}
                </Button>
              </div>

              <div className="rounded-2xl border border-slate-800/70 bg-slate-900/50 p-4">
                {bots.length > 0 ? (
                  <div
                    className="flex flex-col gap-3 overflow-y-auto pr-1"
                    style={{ minHeight: "260px", maxHeight: "420px", scrollbarGutter: "stable" }}
                  >
                    {bots.map((bot) => {
                    const details = botDetails[bot.id];
                    const isRotating = rotatingBotId === bot.id;
                    return (
                      <Card
                        key={bot.id}
                        className="border-slate-800/60 bg-slate-900/70 p-4 text-sm text-slate-300 shadow-sm shadow-black/20"
                      >
                        <div className="flex flex-col gap-3">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <div className="flex items-center gap-2">
                                <p className="text-base font-semibold text-slate-100">{bot.displayName || bot.botId}</p>
                                <Badge variant="default" className="font-mono text-[10px]">ID {bot.botId}</Badge>
                              </div>
                              <p className="text-[11px] text-slate-500">Token stored encrypted at rest</p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <Button variant="ghost" size="sm" onClick={() => handleInspectWebhook(bot.id)} disabled={loadingBotInfoId === bot.id}>
                                {loadingBotInfoId === bot.id ? "Loading…" : "Inspect webhook"}
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleDropPendingUpdates(bot.id)}
                                disabled={busyAction === `drop-updates-${bot.id}`}
                              >
                                {busyAction === `drop-updates-${bot.id}` ? "Dropping…" : "Drop pending"}
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  setRotatingBotId(bot.id);
                                  setRotateTokenValue("");
                                }}
                              >
                                Rotate token
                              </Button>
                              <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => handleRemoveBot(bot.id)}
                                disabled={busyAction === `delete-bot-${bot.id}` || botIsInUse(bot.id)}
                                title={botIsInUse(bot.id) ? "Remove linked subscriptions first" : undefined}
                              >
                                {busyAction === `delete-bot-${bot.id}` ? "Removing…" : "Remove"}
                              </Button>
                            </div>
                          </div>

                          {isRotating && (
                            <div className="rounded-2xl border border-slate-800/70 bg-slate-950/70 p-4">
                              <Label htmlFor={`rotate-${bot.id}`}>New token</Label>
                              <Input
                                id={`rotate-${bot.id}`}
                                placeholder="123456789:BB..."
                                value={rotateTokenValue}
                                onChange={(event) => setRotateTokenValue(event.target.value)}
                                className="mt-2"
                              />
                              <div className="mt-3 flex gap-2">
                                <Button size="sm" onClick={() => handleRotateToken(bot.id)} disabled={busyAction === `rotate-bot-${bot.id}`}>
                                  {busyAction === `rotate-bot-${bot.id}` ? "Saving…" : "Save"}
                                </Button>
                                <Button variant="ghost" size="sm" onClick={() => setRotatingBotId(null)}>
                                  Cancel
                                </Button>
                              </div>
                            </div>
                          )}

                          {details?.webhookInfo && (
                            <div className="rounded-2xl border border-slate-800/70 bg-slate-950/60 p-4 text-xs text-slate-300">
                              <div className="mb-2 flex items-center justify-between">
                                <p className="font-semibold text-slate-100">Webhook insight</p>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setBotWebhookDetails(bot.id, null)}
                                  className="text-[11px] text-slate-400 hover:text-slate-100"
                                >
                                  ✕
                                </Button>
                              </div>
                              <pre className="whitespace-pre-wrap break-all text-[11px] text-slate-200">{JSON.stringify(details.webhookInfo, null, 2)}</pre>
                            </div>
                          )}
                        </div>
                      </Card>
                    );
                  })}
                  </div>
                ) : (
                  <div className="flex min-h-[200px] items-center justify-center rounded-xl border border-dashed border-slate-800/70 bg-slate-900/40 px-4 text-center text-sm text-slate-400">
                    No bots registered yet. Add a BotFather token to begin routing messages.
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Destinations */}
          <Card className="border-slate-800/60 bg-slate-950/75" id="destinations-section">
            <CardHeader>
              <CardTitle>Destinations</CardTitle>
              <CardDescription>Register chats, channels, or topics so each notification lands in the right place.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-3 rounded-2xl border border-slate-800/70 bg-slate-900/60 p-4">
                <div className="space-y-2">
                  <Label htmlFor="dest-chat">Chat ID</Label>
                  <Input
                    id="dest-chat"
                    placeholder="-1001234567890"
                    value={newDestination.chatId}
                    onChange={(event) => setNewDestination((prev) => ({ ...prev, chatId: event.target.value }))}
                  />
                </div>
                <div className="rounded-2xl border border-slate-800/70 bg-slate-900/60 p-4 text-xs text-slate-300">
                  <div className="space-y-3">
                    <div className="space-y-1">
                      <p className="text-sm font-semibold text-slate-100">Detect automatically</p>
                      <p className="text-[11px] text-slate-400">
                        Forward any message from the target chat or reply inside the topic while the bot is present to capture the IDs.
                      </p>
                    </div>
                    <div className="flex flex-col gap-2 md:flex-row md:items-center md:gap-3">
                      <select
                        className={cn(selectClass, "w-full md:max-w-xs")}
                        value={chatLookupBotId}
                        onChange={(event) => setChatLookupBotId(event.target.value)}
                      >
                        <option value="">Select bot…</option>
                        {botOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                      <div className="flex flex-wrap items-center gap-2 md:flex-nowrap">
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => void handleStartChatLookup()}
                          disabled={chatLookupLoading || !chatLookupBotId || isChatLookupPending}
                        >
                          {chatLookupLoading && <Spinner className="mr-2 h-3.5 w-3.5" />}
                          Detect chat ID
                        </Button>
                        {showStopChatLookup ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => void handleStopChatLookup()}
                            disabled={chatLookupStopping}
                          >
                            {chatLookupStopping && <Spinner className="mr-2 h-3.5 w-3.5" />}
                            Stop
                          </Button>
                        ) : null}
                        {canResetChatLookup ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => void handleResetChatLookup()}
                            disabled={chatLookupStopping}
                          >
                            Reset
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                  {isChatLookupPending && chatLookupState.status === "pending" && (
                    <div className="mt-3 rounded-xl border border-sky-500/40 bg-sky-500/10 p-3 text-[11px] text-sky-100">
                      <p className="font-semibold text-sky-200">Waiting for a message…</p>
                      <p className="mt-1 text-[10px] text-sky-200/70">
                        {chatLookupState.expiresAt
                          ? `Capture before ${new Date(chatLookupState.expiresAt).toLocaleTimeString()}.`
                          : "Session active for a short time."}
                      </p>
                    </div>
                  )}
                  {chatLookupCandidates.length > 0 ? (
                    <div className="mt-3 space-y-2">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Detected chats</p>
                      <div className="max-h-56 space-y-2 overflow-y-auto pr-1" style={{ scrollbarGutter: "stable" }}>
                        {chatLookupCandidates.map((candidate) => {
                          const key = getChatLookupCandidateKey(candidate);
                          const selected = chatLookupSelectionKey === key;
                          return (
                            <button
                              type="button"
                              key={key}
                              onClick={() => setChatLookupSelectionKey(key)}
                              className={cn(
                                "flex w-full items-start justify-between gap-3 rounded-xl border px-3 py-2 text-left transition",
                                selected
                                  ? "border-emerald-500/60 bg-emerald-500/10 text-emerald-100"
                                  : "border-slate-800/60 bg-slate-900/50 hover:border-sky-500/50 hover:bg-slate-900/70"
                              )}
                            >
                              <div className="space-y-1">
                                <div className="flex flex-wrap items-center gap-2 text-slate-100">
                                  <span className="font-mono text-sm">{candidate.chatId}</span>
                                  <Badge variant={selected ? "emerald" : "default"} className="text-[10px] uppercase tracking-wide">
                                    {candidate.chatType || "Unknown"}
                                  </Badge>
                                  <Badge variant="sky" className="text-[10px] uppercase tracking-wide">
                                    {candidate.via === "forward" ? "Forward" : "Message"}
                                  </Badge>
                                </div>
                                {(candidate.title || candidate.username) && (
                                  <p className="text-[11px] text-slate-300">
                                    {candidate.title ? candidate.title : ""}
                                    {candidate.title && candidate.username ? " · " : ""}
                                    {candidate.username ? `@${candidate.username}` : ""}
                                  </p>
                                )}
                                {candidate.topicId && (
                                  <p className="text-[10px] text-slate-400">Topic {candidate.topicId}</p>
                                )}
                                <p className="text-[10px] text-slate-500">
                                  Detected {new Date(candidate.detectedAt).toLocaleTimeString()}
                                </p>
                              </div>
                              <div
                                className={cn(
                                  "mt-1 h-2.5 w-2.5 rounded-full border",
                                  selected ? "border-emerald-300 bg-emerald-300" : "border-slate-600 bg-slate-700"
                                )}
                              />
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}
                  {isChatLookupReady && chatLookupCandidates.length === 0 && (
                    <div className="mt-3 rounded-xl border border-slate-800/60 bg-slate-900/60 p-3 text-[11px] text-slate-200">
                      No chats detected yet. Forward a fresh message from the destination to capture the IDs.
                    </div>
                  )}
                  {chatLookupState.status === "expired" && (
                    <div className="mt-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-[11px] text-amber-100">
                      Lookup expired. Send a new message and run detection again.
                    </div>
                  )}
                  {chatLookupState.status === "error" && (
                    <div className="mt-3 rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-[11px] text-red-100">
                      {chatLookupState.message}
                    </div>
                  )}
                  <p className="mt-4 text-[11px] text-slate-400">
                    Bots must stay inside the destination (ideally with admin rights) and must have an open private chat with you.
                    Forward any message from the chat or reply inside the topic to populate the chat and topic IDs.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="dest-title">Title (optional)</Label>
                  <Input
                    id="dest-title"
                    placeholder="Team ops channel"
                    value={newDestination.title}
                    onChange={(event) => setNewDestination((prev) => ({ ...prev, title: event.target.value }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="dest-topic">Topic ID (optional)</Label>
                  <Input
                    id="dest-topic"
                    placeholder="Replies to /getdest show this"
                    value={newDestination.topicId}
                    onChange={(event) => setNewDestination((prev) => ({ ...prev, topicId: event.target.value }))}
                  />
                </div>
                <label className="flex items-center gap-2 text-xs text-slate-300">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-slate-700 bg-slate-900 text-sky-400 focus:ring-sky-400/40"
                    checked={newDestination.isDefault}
                    onChange={(event) => setNewDestination((prev) => ({ ...prev, isDefault: event.target.checked }))}
                  />
                  Set as default destination
                </label>
                <Button onClick={handleAddDestination} disabled={!newDestination.chatId || busyAction === "add-destination"}>
                  {busyAction === "add-destination" ? "Adding…" : "Add destination"}
                </Button>
              </div>

              <div className="rounded-2xl border border-slate-800/70 bg-slate-900/50 p-4">
                {destinations.length > 0 ? (
                  <div
                    className="flex flex-col gap-3 overflow-y-auto pr-1"
                    style={{ minHeight: "260px", maxHeight: "200px", scrollbarGutter: "stable" }}
                  >
                    {destinations.map((dest) => {
                    const isEditing = editingDestinationId === dest.id;
                    const cardClasses = cn(
                      "p-4 text-sm text-slate-300 shadow-sm shadow-black/20",
                      dest.isDefault ? "border-emerald-500/40 bg-emerald-500/10" : "border-slate-800/60 bg-slate-900/70"
                    );
                    return (
                      <Card key={dest.id} className={cardClasses}>
                        {isEditing ? (
                          <div className="space-y-3">
                            <div className="space-y-2">
                              <Label htmlFor={`edit-chat-${dest.id}`}>Chat ID</Label>
                              <Input
                                id={`edit-chat-${dest.id}`}
                                value={destinationForm.chatId}
                                onChange={(event) => setDestinationForm((prev) => ({ ...prev, chatId: event.target.value }))}
                              />
                            </div>
                            <div className="space-y-2">
                              <Label htmlFor={`edit-title-${dest.id}`}>Title</Label>
                              <Input
                                id={`edit-title-${dest.id}`}
                                value={destinationForm.title}
                                onChange={(event) => setDestinationForm((prev) => ({ ...prev, title: event.target.value }))}
                              />
                            </div>
                            <div className="space-y-2">
                              <Label htmlFor={`edit-topic-${dest.id}`}>Topic ID</Label>
                              <Input
                                id={`edit-topic-${dest.id}`}
                                value={destinationForm.topicId}
                                onChange={(event) => setDestinationForm((prev) => ({ ...prev, topicId: event.target.value }))}
                              />
                            </div>
                            <label className="flex items-center gap-2 text-xs text-slate-300">
                              <input
                                type="checkbox"
                                className="h-4 w-4 rounded border-slate-700 bg-slate-900 text-sky-400 focus:ring-sky-400/40"
                                checked={destinationForm.isDefault}
                                onChange={(event) => setDestinationForm((prev) => ({ ...prev, isDefault: event.target.checked }))}
                              />
                              Set as default
                            </label>
                            <div className="flex gap-2">
                              <Button size="sm" onClick={() => saveDestination(dest.id)} disabled={busyAction === `update-destination-${dest.id}`}>
                                {busyAction === `update-destination-${dest.id}` ? "Saving…" : "Save"}
                              </Button>
                              <Button variant="ghost" size="sm" onClick={cancelEditDestination}>
                                Cancel
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                            <div className="space-y-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="font-mono text-xs text-slate-200">{dest.chatId}</p>
                                {dest.isDefault && <Badge variant="emerald">Default</Badge>}
                              </div>
                              <p className="text-[11px] text-slate-500">{dest.title || "Untitled destination"}</p>
                              {dest.topicId && <p className="text-[11px] text-slate-500">Topic ID: {dest.topicId}</p>}
                            </div>
                            <div className="flex flex-wrap items-center gap-2 md:justify-end">
                              {!dest.isDefault && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleSetDefaultDestination(dest.id)}
                                  disabled={busyAction === `default-destination-${dest.id}`}
                                >
                                  {busyAction === `default-destination-${dest.id}` ? "Setting…" : "Set default"}
                                </Button>
                              )}
                              <Button variant="ghost" size="sm" onClick={() => startEditDestination(dest)}>
                                Edit
                              </Button>
                              <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => handleRemoveDestination(dest.id)}
                                disabled={busyAction === `delete-destination-${dest.id}` || destinationIsInUse(dest.id)}
                                title={destinationIsInUse(dest.id) ? "Remove linked subscriptions first" : undefined}
                              >
                                {busyAction === `delete-destination-${dest.id}` ? "Removing…" : "Remove"}
                              </Button>
                            </div>
                          </div>
                        )}
                      </Card>
                    );
                  })}
                  </div>
                ) : (
                  <div className="flex min-h-[200px] items-center justify-center rounded-xl border border-dashed border-slate-800/70 bg-slate-900/40 px-4 text-center text-sm text-slate-400">
                    No destinations yet. Add a chat ID or channel before assigning subscriptions.
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="space-y-6 border-slate-800/60 bg-slate-950/75">
          <CardHeader className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <CardTitle>Subscriptions</CardTitle>
              <CardDescription>Pair repositories with bots and destinations, then grab the GitHub webhook URL and secret.</CardDescription>
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" onClick={() => router.push("/")}>View setup guide</Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 rounded-2xl border border-slate-800/70 bg-slate-900/60 p-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="subscription-repo">Repository</Label>
                <Input
                  id="subscription-repo"
                  placeholder="owner/repo"
                  value={newSubscription.repo}
                  onChange={(event) => setNewSubscription((prev) => ({ ...prev, repo: event.target.value }))}
                />
                <p className="text-xs text-slate-500">Use the owner/repo format or pick from your connected GitHub account.</p>
                <GithubRepoBrowser
                  value={newSubscription.repo}
                  onSelect={(repoFullName) => setNewSubscription((prev) => ({ ...prev, repo: repoFullName }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="subscription-events">Events</Label>
                <div id="subscription-events">
                  <EventsSelector
                    selected={createSelectedEvents}
                    onToggle={handleCreateEventToggle}
                    onSelectAll={() => updateCreateEventsSelection(["*"])}
                  />
                </div>
                <p className="text-xs text-slate-500">Choose which GitHub events should trigger this subscription.</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="subscription-bot">Bot</Label>
                <select
                  id="subscription-bot"
                  className={selectClass}
                  value={newSubscription.botId}
                  onChange={(event) => setNewSubscription((prev) => ({ ...prev, botId: event.target.value }))}
                >
                  <option value="">Select bot</option>
                  {botOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="subscription-dest">Destination</Label>
                <select
                  id="subscription-dest"
                  className={selectClass}
                  value={newSubscription.destinationId}
                  onChange={(event) => setNewSubscription((prev) => ({ ...prev, destinationId: event.target.value }))}
                >
                  <option value="">Select destination</option>
                  {destinationOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-2 md:col-span-2 md:flex-row md:items-center md:justify-between">
                <p className="text-xs text-slate-500">Webhook details will appear below after the subscription is created.</p>
                <Button
                  className="w-full md:w-auto"
                  onClick={handleSubmitSubscription}
                  disabled={!newSubscription.repo || !newSubscription.botId || !newSubscription.destinationId || busyAction === "add-subscription"}
                >
                  {busyAction === "add-subscription" ? "Creating…" : "Create subscription"}
                </Button>
              </div>
            </div>

            {latestWebhook && editingSubscriptionId === null && (
              <Alert variant="info" className="border-sky-500/40 bg-sky-500/10 text-sky-100">
                <AlertDescription className="space-y-3 text-xs">
                  <p className="text-sm font-semibold text-slate-50">Add this webhook to GitHub:</p>
                  <div className="space-y-2">
                    <Copyable value={latestWebhook.repo} label="Repository" successMessage="Repository copied." />
                    <Copyable value={latestWebhook.botLabel} label="Bot" successMessage="Bot copied." />
                    <Copyable value={latestWebhook.destinationLabel} label="Destination" successMessage="Destination copied." />
                    <Copyable value={latestWebhook.payloadUrl} label="Payload URL" successMessage="Payload URL copied." />
                    <Copyable value={latestWebhook.secret} label="Secret" successMessage="Secret copied." />
                    <Copyable value={latestWebhook.contentType} label="Content type" successMessage="Content type copied." truncated />
                    <Copyable value={latestWebhook.events} label="Events" successMessage="Events copied." truncated />
                  </div>
                  <Button variant="secondary" size="sm" onClick={() => setLatestWebhook(null)}>
                    Dismiss
                  </Button>
                </AlertDescription>
              </Alert>
            )}

            <div className="grid gap-4 md:grid-cols-2">
              {subscriptions.length > 0 ? (
                subscriptions.map((sub) => {
                  const webhookPath = `/wh/${sub.hookId}`;
                  const eventsLabel = sub.eventsCsv === "*"
                    ? "All events"
                    : sub.eventsCsv
                        .split(",")
                        .map((event) => event.trim().replace(/_/g, " "))
                        .filter(Boolean)
                        .join(", ");

                  return (
                    <Card key={sub.id} className="border-slate-800/60 bg-slate-900/60 p-4 text-sm text-slate-300">
                      <div className="flex flex-col gap-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="space-y-2">
                          <p className="text-base font-semibold text-slate-100 break-words">{sub.repo}</p>
                          <Badge variant="sky" className="text-[10px] uppercase tracking-wide">
                            {eventsLabel}
                          </Badge>
                        </div>
                        <div className="flex gap-2">
                          <Button variant="ghost" size="sm" onClick={() => startEditSubscription(sub)}>
                            Edit
                          </Button>
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => handleRemoveSubscription(sub.id)}
                            disabled={busyAction === `delete-subscription-${sub.id}`}
                          >
                            {busyAction === `delete-subscription-${sub.id}` ? "Removing…" : "Remove"}
                          </Button>
                        </div>
                      </div>

                      <div className="grid gap-2 sm:grid-cols-2">
                        <Copyable
                          value={botLabelMap.get(sub.botId) ?? String(sub.botId)}
                          label="Bot"
                          successMessage="Bot copied."
                          truncated
                        />
                        <Copyable
                          value={destinationLabelMap.get(sub.destinationId) ?? String(sub.destinationId)}
                          label="Destination"
                          successMessage="Destination copied."
                          truncated
                        />
                        <Copyable
                          value={webhookPath}
                          label="Webhook path"
                          successMessage="Webhook path copied."
                          truncated
                          className="sm:col-span-2"
                        />
                        <Copyable
                          value="application/json"
                          label="Content type"
                          successMessage="Content type copied."
                          truncated
                        />
                      </div>
                      <SpoilerSecret value={sub.secret} />
                    </div>
                    </Card>
                  );
                })
              ) : (
                <Alert variant="info" className="md:col-span-2">
                  <AlertDescription>No subscriptions yet. Create one to generate a GitHub webhook URL and secret.</AlertDescription>
                </Alert>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
    </>
  );
}

function SpoilerSecret({ value }: { value: string }) {
  const [revealed, setRevealed] = useState(false);

  const toggleReveal = () => {
    setRevealed((prev) => !prev);
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success("Secret copied.");
    } catch {
      toast.error("Failed to copy secret.");
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-slate-800/70 bg-slate-900/60 p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Secret</p>
        <p className={cn("font-mono text-xs text-slate-100 break-all transition", revealed ? "blur-0" : "blur-sm select-none")}>
          {value}
        </p>
      </div>
      <div className="flex flex-wrap gap-2 sm:flex-nowrap">
        <Button variant="ghost" size="sm" onClick={toggleReveal}>
          {revealed ? "Hide" : "Reveal"}
        </Button>
        <Button variant="secondary" size="sm" onClick={handleCopy}>
          Copy
        </Button>
      </div>
    </div>
  );
}
