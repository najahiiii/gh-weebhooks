"use client";

import { toast } from "@/components/ui/sonner";
import {
  api,
  type ApiGithubIntegration,
  type ApiGithubRepo,
  type ApiGithubStatus,
  type ApiGithubWebhook,
} from "@/lib/api";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type GithubOAuthMessage = {
  source?: string;
  status?: "success" | "error" | string;
  message?: string;
  username?: string;
};

export function useGithubIntegration() {
  const [githubStatus, setGithubStatus] = useState<ApiGithubStatus | null>(
    null
  );
  const [loadingGithubStatus, setLoadingGithubStatus] = useState(true);
  const [githubRepos, setGithubRepos] = useState<ApiGithubRepo[]>([]);
  const [loadingGithubRepos, setLoadingGithubRepos] = useState(false);
  const [githubConnecting, setGithubConnecting] = useState(false);
  const [githubDisconnecting, setGithubDisconnecting] = useState(false);
  const [githubWebhooksMap, setGithubWebhooksMap] = useState<
    Record<string, ApiGithubWebhook[]>
  >({});
  const [githubWebhookErrors, setGithubWebhookErrors] = useState<
    Record<string, string>
  >({});
  const [githubWebhooksLoading, setGithubWebhooksLoading] = useState(false);
  const [githubWebhooksFetched, setGithubWebhooksFetched] = useState(false);
  const [githubWebhooksExhausted, setGithubWebhooksExhausted] = useState(false);
  const githubPopupRef = useRef<Window | null>(null);
  const githubPopupWatcherRef = useRef<number | null>(null);

  const apiOrigin = useMemo(() => {
    const base = process.env.NEXT_PUBLIC_API_BASE;
    if (base) {
      try {
        return new URL(base).origin;
      } catch (error) {
        console.warn("Invalid NEXT_PUBLIC_API_BASE", error);
        return base;
      }
    }
    if (typeof window !== "undefined") {
      return window.location.origin;
    }
    return "";
  }, []);

  const isGithubConnected = githubStatus?.connected === true;
  const githubAccountUsername = isGithubConnected
    ? githubStatus.account.username ?? ""
    : "";

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
        notifyError(
          `${context}: ${integration.message || "GitHub webhook error."}`
        );
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
    async (options?: {
      force?: boolean;
      notifyIfDisconnected?: boolean;
      silent?: boolean;
    }) => {
      const connected = githubStatus?.connected === true;
      if (!connected && !options?.force) {
        if (options?.notifyIfDisconnected) {
          toast.info("Connect GitHub to browse repositories.");
        }
        return;
      }
      setLoadingGithubRepos(true);
      try {
        const { repositories } = await api.github.repos({
          force: options?.force,
        });
        setGithubRepos(repositories);
      } catch (err) {
        if (!options?.silent) {
          notifyError(
            err instanceof Error
              ? err.message
              : "Failed to load GitHub repositories"
          );
        }
      } finally {
        setLoadingGithubRepos(false);
      }
    },
    [githubStatus, notifyError]
  );

  const loadGithubRepoWebhooks = useCallback(
    async (options?: {
      silent?: boolean;
      perPage?: number;
      maxPages?: number;
      force?: boolean;
    }) => {
      if (!isGithubConnected) {
        if (!options?.silent) {
          toast.info("Connect GitHub to inspect webhooks.");
        }
        return;
      }
      setGithubWebhooksLoading(true);
      try {
        const response = await api.github.webhooks({
          perPage: options?.perPage,
          maxPages: options?.maxPages,
          force: options?.force,
        });
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
          notifyError(
            err instanceof Error
              ? err.message
              : "Failed to load GitHub webhooks"
          );
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
      notifyError(
        err instanceof Error ? err.message : "Failed to start GitHub OAuth"
      );
    } finally {
      setGithubConnecting(false);
    }
  }, [
    clearGithubPopupWatcher,
    loadGithubRepoWebhooks,
    loadGithubRepos,
    notifyError,
    refreshGithubStatus,
  ]);

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
      notifyError(
        err instanceof Error ? err.message : "Failed to disconnect GitHub"
      );
    } finally {
      setGithubDisconnecting(false);
    }
  }, [notifyError, notifySuccess]);

  useEffect(() => {
    void refreshGithubStatus();
  }, [refreshGithubStatus]);

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
  }, [
    isGithubConnected,
    githubRepos.length,
    loadGithubRepos,
    loadingGithubRepos,
  ]);

  useEffect(() => {
    if (!isGithubConnected) {
      return;
    }
    if (!githubWebhooksFetched && !githubWebhooksLoading) {
      void loadGithubRepoWebhooks({ silent: true });
    }
  }, [
    isGithubConnected,
    githubWebhooksFetched,
    githubWebhooksLoading,
    loadGithubRepoWebhooks,
  ]);

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
            updatedAt: new Date().toISOString(),
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
  }, [
    apiOrigin,
    clearGithubPopupWatcher,
    githubAccountUsername,
    githubStatus,
    loadGithubRepoWebhooks,
    loadGithubRepos,
    notifyError,
    refreshGithubStatus,
  ]);

  return {
    githubStatus,
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
  };
}
