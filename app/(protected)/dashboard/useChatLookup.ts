"use client";

import { toast } from "@/components/ui/sonner";
import {
  api,
  type ApiChatLookupCandidate,
  type ApiChatLookupStatus,
} from "@/lib/api";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type ChatLookupState =
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

export const getChatLookupCandidateKey = (candidate: ApiChatLookupCandidate) =>
  `${candidate.chatId}::${candidate.topicId ?? "null"}`;

const normalizeChatLookupCandidates = (
  candidates: ApiChatLookupCandidate[]
): ApiChatLookupCandidate[] => {
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

type ChatLookupOptions = {
  botOptions?: Array<{ value: string; label: string }>;
  onSelection?: (candidate: ApiChatLookupCandidate | null) => void;
};

export function useChatLookup(options?: ChatLookupOptions) {
  const [chatLookupBotId, setChatLookupBotId] = useState("");
  const [chatLookupState, setChatLookupState] = useState<ChatLookupState>({
    status: "idle",
  });
  const [chatLookupSelectionKey, setChatLookupSelectionKey] = useState<
    string | null
  >(null);
  const chatLookupEventSource = useRef<EventSource | null>(null);
  const [chatLookupLoading, setChatLookupLoading] = useState(false);
  const [chatLookupStopping, setChatLookupStopping] = useState(false);
  const chatLookupDetectedRef = useRef(false);
  const prevChatLookupBotId = useRef<string>("");
  const reconnectAttempts = useRef(0);

  const stopEventStream = useCallback(() => {
    if (chatLookupEventSource.current) {
      chatLookupEventSource.current.close();
      chatLookupEventSource.current = null;
    }
  }, []);

  const syncChatLookupSelection = useCallback(
    (candidates: ApiChatLookupCandidate[]) => {
      if (candidates.length === 0) {
        // Keep last explicit selection until user resets or detection stops,
        // so the highlight does not flicker between polling responses.
        return;
      }
      setChatLookupSelectionKey((prev) => {
        if (!prev) {
          return getChatLookupCandidateKey(candidates[0]);
        }
        const exists = candidates.some(
          (candidate) => getChatLookupCandidateKey(candidate) === prev
        );
        return exists ? prev : getChatLookupCandidateKey(candidates[0]);
      });
    },
    []
  );

  const connectEventStream = useCallback(
    (botId: number) => {
      if (chatLookupEventSource.current) {
        chatLookupEventSource.current.close();
      }
      const source = new EventSource(
        `/api/destinations/chat-lookup/stream?botId=${botId}`
      );
      chatLookupEventSource.current = source;
      reconnectAttempts.current = 0;

      source.onmessage = (event) => {
        if (!event.data) return;
        try {
          const payload = JSON.parse(event.data);
          if (payload.type === "status") {
            const status = payload.status as ApiChatLookupStatus;
            if (status.status === "idle") {
              setChatLookupState({ status: "idle" });
              return;
            }
            if (status.status === "expired") {
              setChatLookupState({ status: "expired" });
              return;
            }
            setChatLookupState((prev) => {
              const existing =
                prev.status === "pending" || prev.status === "ready"
                  ? prev.chats
                  : [];
              const nextCandidates = normalizeChatLookupCandidates([
                ...(status.chats ?? []),
                ...existing,
              ]);
              const expiresAt =
                (status as { expiresAt?: string | null }).expiresAt ?? null;
              syncChatLookupSelection(nextCandidates);
              return {
                status: status.status,
                botId,
                chats: nextCandidates,
                expiresAt,
              };
            });
          } else if (payload.type === "detected" && payload.chat) {
            setChatLookupState((prev) => {
              if (
                prev.status !== "pending" &&
                prev.status !== "ready"
              ) {
                return prev;
              }
              const nextCandidates = normalizeChatLookupCandidates([
                ...prev.chats,
                payload.chat as ApiChatLookupCandidate,
              ]);
              syncChatLookupSelection(nextCandidates);
              if (!chatLookupDetectedRef.current) {
                toast.success("Chat ID detected from Telegram.");
                chatLookupDetectedRef.current = true;
              }
              return {
                ...prev,
                status: "ready",
                chats: nextCandidates,
              };
            });
          } else if (payload.type === "expired") {
            setChatLookupState({ status: "expired" });
            setChatLookupSelectionKey(null);
            stopEventStream();
          } else if (payload.type === "cleared") {
            setChatLookupState({ status: "idle" });
            setChatLookupSelectionKey(null);
            stopEventStream();
          } else if (payload.type === "started") {
            setChatLookupState({
              status: "pending",
              botId,
              chats: [],
              expiresAt: payload.expiresAt
                ? new Date(payload.expiresAt).toISOString()
                : null,
            });
          }
        } catch (err) {
          console.warn("Failed to parse chat lookup event", err);
        }
      };

      source.onerror = () => {
        source.close();
        chatLookupEventSource.current = null;
        reconnectAttempts.current += 1;
        const delay = Math.min(5000, 500 * reconnectAttempts.current);
        const currentState = chatLookupState;
        const expired =
          currentState.status === "expired" ||
          (currentState.status === "pending" &&
            currentState.expiresAt &&
            Date.now() > new Date(currentState.expiresAt).getTime());
        if (expired) {
          setChatLookupState({ status: "expired" });
          setChatLookupSelectionKey(null);
          return;
        }
        window.setTimeout(() => {
          if (
            !chatLookupEventSource.current &&
            chatLookupBotId === String(botId)
          ) {
            connectEventStream(botId);
          }
        }, delay);
      };
    },
    [chatLookupBotId, chatLookupState, stopEventStream, syncChatLookupSelection]
  );

  const handleStartChatLookup = useCallback(async () => {
    if (!chatLookupBotId) {
      toast.info("Select a bot before detecting the chat ID.");
      return;
    }
    if (chatLookupState.status === "pending") {
      toast.info(
        "Detection already in progress. Stop it first if you need to restart."
      );
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
      const response = await api.destinations.lookup.start({
        botId: numericBotId,
      });
      setChatLookupState({
        status: "pending",
        botId: numericBotId,
        chats: [],
        expiresAt: response.expiresAt ?? null,
      });
      stopEventStream();
      connectEventStream(numericBotId);
    } catch (err) {
      setChatLookupState({
        status: "error",
        message:
          err instanceof Error ? err.message : "Failed to start chat lookup",
      });
      setChatLookupSelectionKey(null);
      stopEventStream();
    } finally {
      setChatLookupLoading(false);
    }
  }, [chatLookupBotId, chatLookupState.status, connectEventStream, stopEventStream]);

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
      stopEventStream();
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
            return {
              status: "ready",
              botId: prev.botId,
              chats: prev.chats,
              expiresAt: prev.expiresAt ?? null,
            };
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
    [chatLookupBotId, stopEventStream, syncChatLookupSelection]
  );

  const handleResetChatLookup = useCallback(async () => {
    await handleStopChatLookup({ clear: true });
  }, [handleStopChatLookup]);

  useEffect(() => () => stopEventStream(), [stopEventStream]);

  useEffect(() => {
    if (!chatLookupBotId) {
      setChatLookupSelectionKey(null);
      setChatLookupState({ status: "idle" });
      return;
    }
    if (
      prevChatLookupBotId.current &&
      prevChatLookupBotId.current !== chatLookupBotId
    ) {
      stopEventStream();
      setChatLookupState({ status: "idle" });
      setChatLookupSelectionKey(null);
      setChatLookupLoading(false);
      setChatLookupStopping(false);
    }
    prevChatLookupBotId.current = chatLookupBotId;
  }, [chatLookupBotId, stopEventStream]);

  useEffect(() => {
    if (!options?.botOptions || options.botOptions.length === 0) {
      return;
    }
    if (!chatLookupBotId) {
      setChatLookupBotId(options.botOptions[0].value);
      prevChatLookupBotId.current = options.botOptions[0].value;
    }
  }, [chatLookupBotId, options?.botOptions]);

  const chatLookupCandidates = useMemo(() => {
    if (
      chatLookupState.status === "pending" ||
      chatLookupState.status === "ready"
    ) {
      return chatLookupState.chats;
    }
    return [];
  }, [chatLookupState]);

  const selectedChatLookupCandidate = useMemo(() => {
    if (
      chatLookupState.status !== "pending" &&
      chatLookupState.status !== "ready"
    ) {
      return null;
    }
    if (!chatLookupSelectionKey) {
      return null;
    }
    return (
      chatLookupState.chats.find(
        (candidate) =>
          getChatLookupCandidateKey(candidate) === chatLookupSelectionKey
      ) ?? null
    );
  }, [chatLookupSelectionKey, chatLookupState]);

  useEffect(() => {
    if (options?.onSelection) {
      options.onSelection(selectedChatLookupCandidate);
    }
  }, [options, selectedChatLookupCandidate]);

  const isChatLookupPending = chatLookupState.status === "pending";
  const isChatLookupReady = chatLookupState.status === "ready";
  const canResetChatLookup =
    chatLookupState.status === "pending" ||
    chatLookupState.status === "ready" ||
    chatLookupState.status === "expired" ||
    chatLookupState.status === "error";
  const showStopChatLookup = isChatLookupPending || isChatLookupReady;

  return {
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
  };
}
