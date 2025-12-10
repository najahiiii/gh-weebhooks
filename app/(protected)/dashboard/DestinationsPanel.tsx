"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { type ApiChatLookupCandidate, type ApiDestination } from "@/lib/api";
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
import { getChatLookupCandidateKey } from "./useChatLookup";

const selectClass =
  "h-10 w-full rounded-xl border border-slate-800/60 bg-slate-950/60 px-3 text-sm text-slate-100 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";

type ChatLookupProps = {
  botOptions: Array<{ value: string; label: string }>;
  chatLookupBotId: string;
  setChatLookupBotId: (value: string) => void;
  chatLookupCandidates: ApiChatLookupCandidate[];
  chatLookupSelectionKey: string | null;
  setChatLookupSelectionKey: (value: string | null) => void;
  chatLookupState: any;
  chatLookupLoading: boolean;
  chatLookupStopping: boolean;
  handleStartChatLookup: () => Promise<void>;
  handleStopChatLookup: (options?: { clear?: boolean }) => Promise<void>;
  handleResetChatLookup: () => Promise<void>;
  isChatLookupPending: boolean;
  isChatLookupReady: boolean;
  canResetChatLookup: boolean;
  showStopChatLookup: boolean;
};

type DestinationsPanelProps = {
  destinations: ApiDestination[];
  botOptions: Array<{ value: string; label: string }>;
  newDestination: {
    chatId: string;
    title: string;
    topicId: string;
    isDefault: boolean;
  };
  setNewDestination: React.Dispatch<
    React.SetStateAction<{
      chatId: string;
      title: string;
      topicId: string;
      isDefault: boolean;
    }>
  >;
  destinationForm: {
    chatId: string;
    title: string;
    topicId: string;
    isDefault: boolean;
  };
  setDestinationForm: React.Dispatch<
    React.SetStateAction<{
      chatId: string;
      title: string;
      topicId: string;
      isDefault: boolean;
    }>
  >;
  editingDestinationId: number | null;
  busyAction: string | null;
  destinationIsInUse: (id: number) => boolean;
  handleAddDestination: () => Promise<void>;
  startEditDestination: (destination: ApiDestination) => void;
  cancelEditDestination: () => void;
  saveDestination: (id: number) => Promise<void>;
  handleSetDefaultDestination: (id: number) => Promise<void>;
  handleRemoveDestination: (id: number) => Promise<void>;
  chatLookup: ChatLookupProps;
};

export function DestinationsPanel({
  destinations,
  botOptions,
  newDestination,
  setNewDestination,
  destinationForm,
  setDestinationForm,
  editingDestinationId,
  busyAction,
  destinationIsInUse,
  handleAddDestination,
  startEditDestination,
  cancelEditDestination,
  saveDestination,
  handleSetDefaultDestination,
  handleRemoveDestination,
  chatLookup,
}: DestinationsPanelProps) {
  const {
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
  } = chatLookup;

  return (
    <Card
      className="border-slate-800/60 bg-slate-950/75"
      id="destinations-section">
      <CardHeader>
        <CardTitle>Destinations</CardTitle>
        <CardDescription>
          Register chats, channels, or topics so each notification lands in the
          right place.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-3 rounded-2xl border border-slate-800/70 bg-slate-900/60 p-4">
          <div className="space-y-2">
            <Label htmlFor="dest-chat">Chat ID</Label>
            <Input
              id="dest-chat"
              placeholder="-1001234567890"
              value={newDestination.chatId}
              onChange={(event) =>
                setNewDestination((prev) => ({
                  ...prev,
                  chatId: event.target.value,
                }))
              }
            />
          </div>
          <div className="rounded-2xl border border-slate-800/70 bg-slate-900/60 p-4 text-xs text-slate-300">
            <div className="space-y-3">
              <div className="space-y-1">
                <p className="text-sm font-semibold text-slate-100">
                  Detect automatically
                </p>
                <p className="text-[11px] text-slate-400">
                  Forward any message from the target chat or reply inside the
                  topic while the bot is present to capture the IDs.
                </p>
              </div>
              <div className="flex flex-col gap-2 md:flex-row md:items-center md:gap-3">
                <select
                  className={cn(selectClass, "w-full md:max-w-xs")}
                  value={chatLookupBotId}
                  onChange={(event) => setChatLookupBotId(event.target.value)}>
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
                    disabled={
                      chatLookupLoading ||
                      !chatLookupBotId ||
                      isChatLookupPending
                    }>
                    {chatLookupLoading && (
                      <Spinner className="mr-2 h-3.5 w-3.5" />
                    )}
                    Detect chat ID
                  </Button>
                  {showStopChatLookup ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => void handleStopChatLookup()}
                      disabled={chatLookupStopping}>
                      {chatLookupStopping && (
                        <Spinner className="mr-2 h-3.5 w-3.5" />
                      )}
                      Stop
                    </Button>
                  ) : null}
                  {canResetChatLookup ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => void handleResetChatLookup()}
                      disabled={chatLookupStopping}>
                      Reset
                    </Button>
                  ) : null}
                </div>
              </div>
            </div>
            {isChatLookupPending && chatLookupState.status === "pending" && (
              <div className="mt-3 rounded-xl border border-sky-500/40 bg-sky-500/10 p-3 text-[11px] text-sky-100">
                <p className="font-semibold text-sky-200">
                  Waiting for a message…
                </p>
                <p className="mt-1 text-[10px] text-sky-200/70">
                  {chatLookupState.expiresAt
                    ? `Capture before ${new Date(
                        chatLookupState.expiresAt
                      ).toLocaleTimeString()}.`
                    : "Session active for a short time."}
                </p>
              </div>
            )}
            {chatLookupCandidates.length > 0 ? (
              <div className="mt-3 space-y-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  Detected chats
                </p>
                <div
                  className="max-h-56 space-y-2 overflow-y-auto pr-1"
                  style={{ scrollbarGutter: "stable" }}>
                  {chatLookupCandidates.map((candidate) => {
                    const key = getChatLookupCandidateKey(candidate);
                    const isSelected = chatLookupSelectionKey === key;
                    return (
                      <button
                        type="button"
                        key={key}
                        aria-pressed={isSelected}
                        onClick={() => {
                          setChatLookupSelectionKey(key);
                          setNewDestination((prev) => ({
                            ...prev,
                            chatId: candidate.chatId,
                            title: candidate.title || prev.title,
                            topicId: candidate.topicId
                              ? String(candidate.topicId)
                              : "",
                          }));
                        }}
                        className={cn(
                          "flex w-full items-start justify-between gap-3 rounded-xl border px-3 py-2 text-left transition",
                          isSelected
                            ? "border-emerald-400/70 bg-emerald-500/10 text-emerald-100 ring-2 ring-emerald-400/60 shadow-lg shadow-emerald-500/20"
                            : "border-slate-800/60 bg-slate-900/50 hover:border-sky-500/50 hover:bg-slate-900/70"
                        )}>
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-2 text-slate-100">
                            <span className="font-mono text-sm">
                              {candidate.title || candidate.username
                                ? candidate.title || `@${candidate.username}`
                                : candidate.chatId}
                            </span>
                            <Badge
                              variant={isSelected ? "emerald" : "default"}
                              className="text-[10px] uppercase tracking-wide">
                              {candidate.chatType || "Unknown"}
                            </Badge>
                            <Badge
                              variant="sky"
                              className="text-[10px] uppercase tracking-wide">
                              {candidate.via === "forward"
                                ? "Forward"
                                : "Message"}
                            </Badge>
                          </div>
                          <p className="text-[10px] text-slate-400">
                            Chat ID: {candidate.chatId}
                          </p>
                          {candidate.topicId ? (
                            <p className="text-[10px] text-slate-400">
                              Topic: {candidate.topicId}
                            </p>
                          ) : null}
                          <p className="text-[10px] text-slate-500">
                            Detected{" "}
                            {new Date(
                              candidate.detectedAt
                            ).toLocaleTimeString()}
                          </p>
                        </div>
                        <div
                          className={cn(
                            "mt-1 h-2.5 w-2.5 rounded-full border",
                            isSelected
                              ? "border-emerald-300 bg-emerald-300"
                              : "border-slate-600 bg-slate-700"
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
                No chats detected yet. Forward a fresh message from the
                destination to capture the IDs.
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
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="dest-title">Title</Label>
              <Input
                id="dest-title"
                placeholder="Team alerts"
                value={newDestination.title}
                onChange={(event) =>
                  setNewDestination((prev) => ({
                    ...prev,
                    title: event.target.value,
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="dest-topic">Topic ID (optional)</Label>
              <Input
                id="dest-topic"
                placeholder="Topic/thread id"
                value={newDestination.topicId}
                onChange={(event) =>
                  setNewDestination((prev) => ({
                    ...prev,
                    topicId: event.target.value,
                  }))
                }
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-slate-400">
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-slate-700 bg-slate-900 accent-sky-400"
                checked={newDestination.isDefault}
                onChange={(event) =>
                  setNewDestination((prev) => ({
                    ...prev,
                    isDefault: event.target.checked,
                  }))
                }
              />
              Set as default destination
            </label>
            <Button
              size="sm"
              onClick={() => void handleAddDestination()}
              disabled={
                !newDestination.chatId || busyAction === "add-destination"
              }>
              {busyAction === "add-destination" ? "Adding…" : "Add destination"}
            </Button>
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-100">
              Saved destinations
            </p>
            <Badge
              variant="default"
              className="text-[10px] uppercase tracking-wide">
              {destinations.length} total
            </Badge>
          </div>
          {destinations.length > 0 ? (
            <div className="grid gap-3 md:grid-cols-2">
              {destinations.map((dest) => (
                <Card
                  key={dest.id}
                  className="border-slate-800/60 bg-slate-900/60 p-4 text-sm text-slate-300">
                  <div className="flex flex-col gap-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="space-y-1">
                        <p className="text-base font-semibold text-slate-100">
                          {dest.title || dest.chatId}
                        </p>
                        <p className="text-xs text-slate-400">{dest.chatId}</p>
                        {dest.topicId ? (
                          <p className="text-[11px] text-slate-500">
                            Topic {dest.topicId}
                          </p>
                        ) : null}
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge
                            variant={dest.isDefault ? "emerald" : "default"}
                            className="text-[10px] uppercase tracking-wide">
                            {dest.isDefault ? "Default" : "Destination"}
                          </Badge>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {dest.isDefault ? (
                          <Button variant="ghost" size="sm" disabled>
                            Default
                          </Button>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              void handleSetDefaultDestination(dest.id)
                            }
                            disabled={
                              busyAction === `default-destination-${dest.id}`
                            }>
                            {busyAction === `default-destination-${dest.id}`
                              ? "Saving…"
                              : "Set default"}
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => startEditDestination(dest)}>
                          Edit
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => handleRemoveDestination(dest.id)}
                          disabled={
                            busyAction === `delete-destination-${dest.id}` ||
                            destinationIsInUse(dest.id)
                          }
                          title={
                            destinationIsInUse(dest.id)
                              ? "Remove linked subscriptions first"
                              : undefined
                          }>
                          {busyAction === `delete-destination-${dest.id}`
                            ? "Removing…"
                            : "Remove"}
                        </Button>
                      </div>
                    </div>
                    {editingDestinationId === dest.id ? (
                      <div className="space-y-3 rounded-2xl border border-slate-800/60 bg-slate-950/60 p-3">
                        <div className="grid gap-3 md:grid-cols-2">
                          <div className="space-y-2">
                            <Label htmlFor={`edit-chat-${dest.id}`}>
                              Chat ID
                            </Label>
                            <Input
                              id={`edit-chat-${dest.id}`}
                              value={destinationForm.chatId}
                              onChange={(event) =>
                                setDestinationForm((prev) => ({
                                  ...prev,
                                  chatId: event.target.value,
                                }))
                              }
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor={`edit-title-${dest.id}`}>
                              Title
                            </Label>
                            <Input
                              id={`edit-title-${dest.id}`}
                              value={destinationForm.title}
                              onChange={(event) =>
                                setDestinationForm((prev) => ({
                                  ...prev,
                                  title: event.target.value,
                                }))
                              }
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor={`edit-topic-${dest.id}`}>
                              Topic ID
                            </Label>
                            <Input
                              id={`edit-topic-${dest.id}`}
                              value={destinationForm.topicId}
                              onChange={(event) =>
                                setDestinationForm((prev) => ({
                                  ...prev,
                                  topicId: event.target.value,
                                }))
                              }
                            />
                          </div>
                          <div className="flex items-center gap-2 text-xs text-slate-400">
                            <input
                              id={`edit-default-${dest.id}`}
                              type="checkbox"
                              className="h-4 w-4 rounded border-slate-700 bg-slate-900 accent-sky-400"
                              checked={destinationForm.isDefault}
                              onChange={(event) =>
                                setDestinationForm((prev) => ({
                                  ...prev,
                                  isDefault: event.target.checked,
                                }))
                              }
                            />
                            <Label
                              htmlFor={`edit-default-${dest.id}`}
                              className="text-xs text-slate-400">
                              Set as default
                            </Label>
                          </div>
                        </div>
                        <div className="flex flex-wrap justify-end gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={cancelEditDestination}>
                            Cancel
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => void saveDestination(dest.id)}
                            disabled={
                              busyAction === `update-destination-${dest.id}` ||
                              !destinationForm.chatId.trim()
                            }>
                            {busyAction === `update-destination-${dest.id}`
                              ? "Saving…"
                              : "Save"}
                          </Button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                </Card>
              ))}
            </div>
          ) : (
            <div className="flex min-h-[200px] items-center justify-center rounded-xl border border-dashed border-slate-800/70 bg-slate-900/40 px-4 text-center text-sm text-slate-400">
              No destinations yet. Add a chat ID or channel before assigning
              subscriptions.
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
