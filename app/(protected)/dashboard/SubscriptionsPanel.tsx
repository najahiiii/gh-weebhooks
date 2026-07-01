"use client";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Copyable } from "@/components/ui/copyable";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  api,
  type ApiGithubIntegration,
  type ApiGithubRepo,
  type ApiGithubWebhook,
  type ApiSubscription,
} from "@/lib/api";
import { FolderGit } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type UIEvent } from "react";
import { GithubRepoBrowser } from "./GithubRepoBrowser";

type GithubProps = {
  isGithubConnected: boolean;
  loadingGithubStatus: boolean;
  githubAccountUsername: string;
  githubRepos: ApiGithubRepo[];
  loadingGithubRepos: boolean;
  githubWebhooksMap: Record<string, ApiGithubWebhook[]>;
  githubWebhookErrors: Record<string, string>;
  githubWebhooksLoading: boolean;
  githubWebhooksExhausted: boolean;
  githubConnecting: boolean;
  githubDisconnecting: boolean;
  onConnectGithub: () => void | Promise<void>;
  onDisconnectGithub: () => void | Promise<void>;
  onRefreshRepos: (options?: {
    notifyIfDisconnected?: boolean;
    force?: boolean;
    silent?: boolean;
  }) => void | Promise<void>;
  onRefreshWebhooks: (options?: {
    silent?: boolean;
    perPage?: number;
    maxPages?: number;
    force?: boolean;
  }) => void | Promise<void>;
  githubWebhooksFetched: boolean;
};

type SubscriptionsPanelProps = {
  subscriptions: ApiSubscription[];
  setSubscriptions: React.Dispatch<React.SetStateAction<ApiSubscription[]>>;
  botOptions: Array<{ value: string; label: string }>;
  destinationOptions: Array<{
    value: string;
    label: string;
    isDefault: boolean;
  }>;
  botLabelMap: Map<number, string>;
  destinationLabelMap: Map<number, string>;
  notifySuccess: (message: string) => void;
  notifyError: (message: string) => void;
  handleGithubIntegrationFeedback: (
    integration: ApiGithubIntegration,
    context: string,
  ) => void;
  busyAction: string | null;
  setBusyAction: React.Dispatch<React.SetStateAction<string | null>>;
  github: GithubProps;
};

const selectClass =
  "h-10 w-full rounded-xl border border-slate-800/60 bg-slate-950/60 px-3 text-sm text-slate-100 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";

type EventsSelectorProps = {
  selected: string[];
  onToggle: (eventName: string, checked: boolean) => void;
  onSelectAll: () => void;
  eventsOptions: string[];
  eventsScrollRef: React.MutableRefObject<number>;
};

const EventsSelector = ({
  selected,
  onToggle,
  onSelectAll,
  eventsOptions,
  eventsScrollRef,
}: EventsSelectorProps) => {
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = listRef.current;
    if (!node) {
      return;
    }
    node.scrollTop = eventsScrollRef.current;
  }, [selected, eventsScrollRef]);

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
        style={{ scrollbarGutter: "stable both-edges" }}>
        {eventsOptions.length > 0 ? (
          eventsOptions.map((event) => {
            const checked = !selected.includes("*") && selected.includes(event);
            return (
              <label
                key={event}
                className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-slate-200 transition hover:bg-slate-900/40">
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

type SubscriptionFormState = {
  repo: string;
  events: string;
  botId: string;
  destinationId: string;
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

export function SubscriptionsPanel({
  subscriptions,
  setSubscriptions,
  botOptions,
  destinationOptions,
  botLabelMap,
  destinationLabelMap,
  notifySuccess,
  notifyError,
  handleGithubIntegrationFeedback,
  busyAction,
  setBusyAction,
  github,
}: SubscriptionsPanelProps) {
  const baseUrl =
    (process.env.NEXT_PUBLIC_API_BASE || "").replace(/\/$/, "") || "";
  const [eventsOptions, setEventsOptions] = useState<string[]>([]);
  const [createSelectedEvents, setCreateSelectedEvents] = useState<string[]>([
    "*",
  ]);
  const [editSelectedEvents, setEditSelectedEvents] = useState<string[]>(["*"]);
  const [editSubscription, setEditSubscription] =
    useState<SubscriptionFormState>({
      repo: "",
      botId: "",
      destinationId: "",
      events: "*",
    });
  const [newSubscription, setNewSubscription] = useState<SubscriptionFormState>(
    {
      repo: "",
      events: "*",
      botId: "",
      destinationId: "",
    },
  );
  const [editingSubscriptionId, setEditingSubscriptionId] = useState<
    number | null
  >(null);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<ApiSubscription | null>(
    null,
  );
  const [latestWebhook, setLatestWebhook] = useState<WebhookHelper | null>(
    null,
  );
  const eventsScrollRef = useRef(0);

  const isSavingEdit =
    editingSubscriptionId !== null &&
    busyAction === `update-subscription-${editingSubscriptionId}`;

  const parseEventsCsv = (value: string): string[] => {
    if (!value || value === "*") {
      return ["*"];
    }
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  };

  const updateCreateEventsSelection = (nextSelection: string[]) => {
    const normalized =
      nextSelection.length === 0 ? ["*"] : Array.from(new Set(nextSelection));
    setCreateSelectedEvents(normalized);
    setNewSubscription((prev) => ({
      ...prev,
      events: normalized.includes("*") ? "*" : normalized.join(","),
    }));
  };

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

  const updateEditEventsSelection = (nextSelection: string[]) => {
    const normalized =
      nextSelection.length === 0 ? ["*"] : Array.from(new Set(nextSelection));
    setEditSelectedEvents(normalized);
    setEditSubscription((prev) => ({
      ...prev,
      events: normalized.includes("*") ? "*" : normalized.join(","),
    }));
  };

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

  useEffect(() => {
    const fetchEvents = async () => {
      try {
        const response = await api.events.list();
        setEventsOptions(response.events);
      } catch (err) {
        console.warn("Failed to fetch GitHub events list", err);
        setEventsOptions([
          "push",
          "pull_request",
          "issues",
          "release",
          "workflow_run",
          "ping",
        ]);
      }
    };
    fetchEvents();
  }, []);

  useEffect(() => {
    if (!eventsOptions.length) {
      return;
    }
    if (!createSelectedEvents.includes("*")) {
      const filteredCreate = createSelectedEvents.filter((event) =>
        eventsOptions.includes(event),
      );
      if (filteredCreate.length !== createSelectedEvents.length) {
        updateCreateEventsSelection(filteredCreate);
      }
    }
    if (!editSelectedEvents.includes("*")) {
      const filteredEdit = editSelectedEvents.filter((event) =>
        eventsOptions.includes(event),
      );
      if (filteredEdit.length !== editSelectedEvents.length) {
        updateEditEventsSelection(filteredEdit);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventsOptions]);

  const handleSubmitSubscription = async () => {
    const repo = newSubscription.repo.trim();
    if (!repo || !newSubscription.botId || !newSubscription.destinationId) {
      notifyError("Repository, bot, and destination are required.");
      return;
    }
    const botId = Number.parseInt(newSubscription.botId, 10);
    const destinationId = Number.parseInt(newSubscription.destinationId, 10);
    const eventsValue = createSelectedEvents.includes("*")
      ? "*"
      : createSelectedEvents.join(",");

    setBusyAction("add-subscription");
    try {
      const response = await api.subscriptions.create({
        repo,
        events: eventsValue,
        botId,
        destinationId,
      });
      if (response.subscription) {
        setSubscriptions((prev) => [
          response.subscription as ApiSubscription,
          ...prev,
        ]);
        setLatestWebhook({
          repo: response.subscription.repo,
          payloadUrl: response.webhook.payloadUrl,
          secret: response.webhook.secret,
          events: response.webhook.events,
          contentType: response.webhook.contentType ?? "application/json",
          botLabel: botLabelMap.get(botId) ?? String(botId),
          destinationLabel:
            destinationLabelMap.get(destinationId) ?? String(destinationId),
        });
      }
      setNewSubscription({
        repo: "",
        events: "*",
        botId: "",
        destinationId: "",
      });
      updateCreateEventsSelection(["*"]);
      notifySuccess("Subscription created.");
      handleGithubIntegrationFeedback(
        response.githubIntegration,
        "GitHub webhook creation",
      );
    } catch (err) {
      notifyError(
        err instanceof Error ? err.message : "Failed to add subscription",
      );
    } finally {
      setBusyAction(null);
    }
  };

  const handleOpenEditSubscription = (subscription: ApiSubscription) => {
    setEditingSubscriptionId(subscription.id);
    const events = parseEventsCsv(subscription.eventsCsv);
    setEditSelectedEvents(events);
    setEditSubscription({
      repo: subscription.repo,
      botId: String(subscription.botId),
      destinationId: String(subscription.destinationId),
      events: events.includes("*") ? "*" : events.join(","),
    });
    setIsEditDialogOpen(true);
  };

  const cancelEditSubscription = () => {
    setIsEditDialogOpen(false);
    setEditingSubscriptionId(null);
    setEditSubscription({
      repo: "",
      botId: "",
      destinationId: "",
      events: "*",
    });
    setEditSelectedEvents(["*"]);
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
    const eventsValue = editSelectedEvents.includes("*")
      ? "*"
      : editSelectedEvents.join(",");
    setBusyAction(`update-subscription-${editingSubscriptionId}`);
    try {
      const response = await api.subscriptions.update(editingSubscriptionId, {
        repo,
        events: eventsValue,
        botId,
        destinationId,
      });
      if (response.subscription) {
        setSubscriptions((prev) =>
          prev.map((sub) =>
            sub.id === editingSubscriptionId
              ? (response.subscription as ApiSubscription)
              : sub,
          ),
        );
      } else {
        setSubscriptions((prev) =>
          prev.map((sub) =>
            sub.id === editingSubscriptionId
              ? { ...sub, repo, eventsCsv: eventsValue, botId, destinationId }
              : sub,
          ),
        );
      }
      cancelEditSubscription();
      notifySuccess("Subscription updated.");
      handleGithubIntegrationFeedback(
        response.githubIntegration,
        "GitHub webhook update",
      );
    } catch (err) {
      notifyError(
        err instanceof Error ? err.message : "Failed to update subscription",
      );
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
      handleGithubIntegrationFeedback(
        response.githubIntegration,
        "GitHub webhook removal",
      );
    } catch (err) {
      notifyError(
        err instanceof Error ? err.message : "Failed to remove subscription",
      );
    } finally {
      setBusyAction(null);
      setPendingDelete(null);
    }
  };

  const eventsList = useMemo(() => eventsOptions, [eventsOptions]);

  return (
    <Card className="space-y-6 border-slate-800/60 bg-slate-950/75">
      <CardHeader className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <CardTitle>Subscriptions</CardTitle>
          <CardDescription>
            Pair repositories with bots and destinations, then grab the GitHub
            webhook URL and secret.
          </CardDescription>
        </div>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => window.location.assign("/")}>
            View setup guide
          </Button>
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
              onChange={(event) =>
                setNewSubscription((prev) => ({
                  ...prev,
                  repo: event.target.value,
                }))
              }
            />
            <p className="text-xs text-slate-500">
              Use the owner/repo format or pick from your connected GitHub
              account.
            </p>
            <GithubRepoBrowser
              value={newSubscription.repo}
              onSelect={(repoFullName) =>
                setNewSubscription((prev) => ({
                  ...prev,
                  repo: repoFullName,
                }))
              }
              isGithubConnected={github.isGithubConnected}
              loadingGithubStatus={github.loadingGithubStatus}
              githubAccountUsername={github.githubAccountUsername}
              githubRepos={github.githubRepos}
              loadingGithubRepos={github.loadingGithubRepos}
              githubWebhooksMap={github.githubWebhooksMap}
              githubWebhookErrors={github.githubWebhookErrors}
              githubWebhooksLoading={github.githubWebhooksLoading}
              githubWebhooksExhausted={github.githubWebhooksExhausted}
              githubConnecting={github.githubConnecting}
              githubDisconnecting={github.githubDisconnecting}
              onConnectGithub={github.onConnectGithub}
              onDisconnectGithub={github.onDisconnectGithub}
              onRefreshRepos={github.onRefreshRepos}
              onRefreshWebhooks={github.onRefreshWebhooks}
              githubWebhooksFetched={github.githubWebhooksFetched}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="subscription-events">Events</Label>
            <div id="subscription-events">
              <EventsSelector
                selected={createSelectedEvents}
                onToggle={handleCreateEventToggle}
                onSelectAll={() => updateCreateEventsSelection(["*"])}
                eventsOptions={eventsList}
                eventsScrollRef={eventsScrollRef}
              />
            </div>
            <p className="text-xs text-slate-500">
              Choose which GitHub events should trigger this subscription.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="subscription-bot">Bot</Label>
            <select
              id="subscription-bot"
              className={selectClass}
              value={newSubscription.botId}
              onChange={(event) =>
                setNewSubscription((prev) => ({
                  ...prev,
                  botId: event.target.value,
                }))
              }>
              <option value="">Select bot…</option>
              {botOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="subscription-destination">Destination</Label>
            <select
              id="subscription-destination"
              className={selectClass}
              value={newSubscription.destinationId}
              onChange={(event) =>
                setNewSubscription((prev) => ({
                  ...prev,
                  destinationId: event.target.value,
                }))
              }>
              <option value="">Select destination…</option>
              {destinationOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                  {option.isDefault ? " (default)" : ""}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-2 md:col-span-2 md:flex-row md:items-center md:justify-between">
            <p className="text-xs text-slate-500">
              Webhook details will appear below after the subscription is
              created.
            </p>
            <Button
              className="w-full md:w-auto"
              onClick={handleSubmitSubscription}
              disabled={
                !newSubscription.repo ||
                !newSubscription.botId ||
                !newSubscription.destinationId ||
                busyAction === "add-subscription"
              }>
              {busyAction === "add-subscription"
                ? "Creating…"
                : "Create subscription"}
            </Button>
          </div>
        </div>

        {latestWebhook && editingSubscriptionId === null && (
          <Alert
            variant="info"
            className="border-sky-500/40 bg-sky-500/10 text-sky-100">
            <AlertDescription className="space-y-3 text-xs">
              <p className="text-sm font-semibold text-slate-50">
                Add this webhook to GitHub:
              </p>
              <div className="space-y-2">
                <Copyable
                  value={latestWebhook.repo}
                  label="Repository"
                  successMessage="Repository copied."
                />
                <Copyable
                  value={latestWebhook.botLabel}
                  label="Bot"
                  successMessage="Bot copied."
                />
                <Copyable
                  value={latestWebhook.destinationLabel}
                  label="Destination"
                  successMessage="Destination copied."
                />
                <Copyable
                  value={latestWebhook.payloadUrl}
                  label="Payload URL"
                  successMessage="Payload URL copied."
                />
                <Copyable
                  value={latestWebhook.secret}
                  label="Secret"
                  successMessage="Secret copied."
                />
                <Copyable
                  value={latestWebhook.contentType}
                  label="Content type"
                  successMessage="Content type copied."
                  truncated
                />
                <Copyable
                  value={latestWebhook.events}
                  label="Events"
                  successMessage="Events copied."
                  truncated
                />
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setLatestWebhook(null)}>
                Dismiss
              </Button>
            </AlertDescription>
          </Alert>
        )}

        <div className="space-y-3 rounded-2xl border border-slate-800/70 bg-slate-900/60 p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-slate-100">
                Subscriptions
              </p>
              <p className="text-xs text-slate-500">
                Manage your GitHub repository links and webhook routing.
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              disabled={busyAction === "refresh-subscriptions"}
              onClick={() => {
                setBusyAction("refresh-subscriptions");
                api.subscriptions
                  .list()
                  .then((res) => setSubscriptions(res.subscriptions))
                  .catch((err) => {
                    notifyError(
                      err instanceof Error
                        ? err.message
                        : "Failed to refresh subscriptions",
                    );
                  })
                  .finally(() => setBusyAction(null));
              }}>
              {busyAction === "refresh-subscriptions"
                ? "Refreshing…"
                : "Refresh"}
            </Button>
          </div>
          {subscriptions.length === 0 ? (
            <div className="flex min-h-[140px] items-center justify-center rounded-xl border border-dashed border-slate-800/70 bg-slate-900/50 px-4 text-center text-sm text-slate-400">
              No subscriptions yet. Connect a repository to begin forwarding
              events.
            </div>
          ) : (
            <div className="space-y-3">
              {subscriptions.map((sub) => {
                const eventSummary =
                  sub.eventsCsv === "*"
                    ? "All events"
                    : sub.eventsCsv
                        .split(",")
                        .map((e) => e.trim())
                        .filter(Boolean)
                        .slice(0, 4)
                        .join(", ");
                const hasMore =
                  sub.eventsCsv !== "*" &&
                  sub.eventsCsv.split(",").filter(Boolean).length > 4;
                return (
                  <div
                    key={sub.id}
                    className="rounded-xl border border-slate-800/70 bg-slate-950/50 p-4 text-sm text-slate-200">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="space-y-1">
                        <p className="flex items-center gap-2 text-base font-semibold text-slate-100">
                          <FolderGit className="h-4 w-4 text-slate-400" />
                          {sub.repo}
                        </p>
                        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                          <Badge
                            variant="default"
                            className="text-[10px] uppercase tracking-wide">
                            Hook {sub.hookId}
                          </Badge>
                          <Badge
                            variant="default"
                            className="text-[10px] uppercase tracking-wide">
                            Bot {botLabelMap.get(sub.botId) || sub.botId}
                          </Badge>
                          <Badge
                            variant="sky"
                            className="text-[10px] uppercase tracking-wide">
                            Destination{" "}
                            {destinationLabelMap.get(sub.destinationId) ||
                              sub.destinationId}
                          </Badge>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleOpenEditSubscription(sub)}
                          disabled={busyAction?.startsWith(
                            "update-subscription-",
                          )}>
                          Edit
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setPendingDelete(sub)}
                          disabled={
                            busyAction === `delete-subscription-${sub.id}`
                          }>
                          {busyAction === `delete-subscription-${sub.id}`
                            ? "Removing…"
                            : "Remove"}
                        </Button>
                      </div>
                    </div>
                    <div className="mt-3 grid gap-3 md:grid-cols-3">
                      <div className="rounded-xl border border-slate-800/60 bg-slate-900/50 p-3 text-xs text-slate-300">
                        <p className="text-[11px] uppercase tracking-wide text-slate-500">
                          Events
                        </p>
                        <p className="mt-1">
                          {eventSummary}
                          {hasMore ? " + more" : ""}
                        </p>
                      </div>
                      <div className="rounded-xl border border-slate-800/60 bg-slate-900/50 p-3 text-xs text-slate-300">
                        <p className="text-[11px] uppercase tracking-wide text-slate-500">
                          Webhook URL
                        </p>
                        <p className="mt-1 break-all text-slate-200">
                          {baseUrl
                            ? `${baseUrl}/wh/${sub.hookId}`
                            : `/wh/${sub.hookId}`}
                        </p>
                      </div>
                      <div className="rounded-xl border border-slate-800/60 bg-slate-900/50 p-3 text-xs text-slate-300">
                        <p className="text-[11px] uppercase tracking-wide text-slate-500">
                          GitHub sync
                        </p>
                        <p className="mt-1">
                          {sub.githubSyncStatus || "not_attempted"}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <Dialog
          open={isEditDialogOpen}
          onOpenChange={(open) => {
            if (!open) {
              cancelEditSubscription();
            }
          }}>
          <DialogContent className="max-w-4xl border border-slate-800/70 bg-slate-900/90 text-slate-100">
            <DialogHeader className="space-y-1">
              <DialogTitle>Edit subscription</DialogTitle>
              <DialogDescription className="text-slate-400">
                {editSubscription.repo || "owner/repo"}
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="edit-subscription-repo">Repository</Label>
                <Input
                  id="edit-subscription-repo"
                  placeholder="owner/repo"
                  value={editSubscription.repo}
                  onChange={(event) =>
                    setEditSubscription((prev) => ({
                      ...prev,
                      repo: event.target.value,
                    }))
                  }
                />
                <GithubRepoBrowser
                  value={editSubscription.repo}
                  onSelect={(repoFullName) =>
                    setEditSubscription((prev) => ({
                      ...prev,
                      repo: repoFullName,
                    }))
                  }
                  isGithubConnected={github.isGithubConnected}
                  loadingGithubStatus={github.loadingGithubStatus}
                  githubAccountUsername={github.githubAccountUsername}
                  githubRepos={github.githubRepos}
                  loadingGithubRepos={github.loadingGithubRepos}
                  githubWebhooksMap={github.githubWebhooksMap}
                  githubWebhookErrors={github.githubWebhookErrors}
                  githubWebhooksLoading={github.githubWebhooksLoading}
                  githubWebhooksExhausted={github.githubWebhooksExhausted}
                  githubConnecting={github.githubConnecting}
                  githubDisconnecting={github.githubDisconnecting}
                  onConnectGithub={github.onConnectGithub}
                  onDisconnectGithub={github.onDisconnectGithub}
                  onRefreshRepos={github.onRefreshRepos}
                  onRefreshWebhooks={github.onRefreshWebhooks}
                  githubWebhooksFetched={github.githubWebhooksFetched}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-subscription-events">Events</Label>
                <div id="edit-subscription-events">
                  <EventsSelector
                    selected={editSelectedEvents}
                    onToggle={handleEditEventToggle}
                    onSelectAll={() => updateEditEventsSelection(["*"])}
                    eventsOptions={eventsList}
                    eventsScrollRef={eventsScrollRef}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-subscription-bot">Bot</Label>
                <select
                  id="edit-subscription-bot"
                  className={selectClass}
                  value={editSubscription.botId}
                  onChange={(event) =>
                    setEditSubscription((prev) => ({
                      ...prev,
                      botId: event.target.value,
                    }))
                  }>
                  <option value="">Select bot…</option>
                  {botOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-subscription-destination">
                  Destination
                </Label>
                <select
                  id="edit-subscription-destination"
                  className={selectClass}
                  value={editSubscription.destinationId}
                  onChange={(event) =>
                    setEditSubscription((prev) => ({
                      ...prev,
                      destinationId: event.target.value,
                    }))
                  }>
                  <option value="">Select destination…</option>
                  {destinationOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                      {option.isDefault ? " (default)" : ""}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <DialogFooter className="pt-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={cancelEditSubscription}
                disabled={isSavingEdit}>
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleSaveEditSubscription}
                disabled={
                  isSavingEdit ||
                  !editSubscription.repo.trim() ||
                  !editSubscription.botId ||
                  !editSubscription.destinationId
                }>
                {isSavingEdit ? "Saving…" : "Save changes"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog
          open={pendingDelete !== null}
          onOpenChange={(open) => {
            if (!open) {
              setPendingDelete(null);
            }
          }}>
          <DialogContent className="max-w-md border border-slate-800/70 bg-slate-900/90 text-slate-100">
            <DialogHeader>
              <DialogTitle>
                Hapus subs ({pendingDelete?.repo ?? "owner/repo"})?
              </DialogTitle>
              <DialogDescription className="text-slate-400">
                Aksi ini akan menghapus subscription dan webhook terkait.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="secondary"
                onClick={() => setPendingDelete(null)}
                disabled={
                  pendingDelete !== null &&
                  busyAction === `delete-subscription-${pendingDelete.id}`
                }>
                Tidak
              </Button>
              <Button
                variant="destructive"
                onClick={() =>
                  pendingDelete && handleRemoveSubscription(pendingDelete.id)
                }
                disabled={
                  !pendingDelete ||
                  busyAction === `delete-subscription-${pendingDelete.id}`
                }>
                {pendingDelete &&
                busyAction === `delete-subscription-${pendingDelete.id}`
                  ? "Removing…"
                  : "Ya"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
