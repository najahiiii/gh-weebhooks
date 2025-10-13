const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:4000";

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export type ApiUser = {
  id: number;
  username: string | null;
  telegramUserId: string;
  isAdmin: boolean;
};

export type ApiBot = {
  id: number;
  botId: string;
  token: string;
  displayName: string;
  ownerUserId?: number;
  createdAt?: string;
};

export type ApiWebhookInfo = Record<string, unknown> | null;

export type ApiDestination = {
  id: number;
  ownerUserId: number;
  chatId: string;
  title: string;
  isDefault: boolean;
  topicId: number | null;
};

export type ApiChatLookupStart = {
  status: "pending";
  expiresAt: string;
};

export type ApiChatLookupCandidate = {
  chatId: string;
  chatType: string | null;
  title: string | null;
  username: string | null;
  topicId: number | null;
  via: "forward" | "message";
  detectedAt: number;
};

export type ApiChatLookupStatus =
  | { status: "idle" }
  | { status: "pending"; expiresAt: string; chats: ApiChatLookupCandidate[] }
  | { status: "ready"; chats: ApiChatLookupCandidate[] }
  | { status: "expired" };

export type ApiSubscription = {
  id: number;
  ownerUserId?: number;
  hookId: string;
  secret: string;
  repo: string;
  eventsCsv: string;
  botId: number;
  destinationId: number;
  createdAt?: string;
  githubHookId?: string | null;
  githubHookUrl?: string | null;
  githubSyncStatus?: string;
  githubSyncError?: string | null;
  githubSyncedAt?: string | null;
};

export type ApiSubscriptionWebhook = {
  payloadUrl: string;
  secret: string;
  events: string;
  contentType: string;
};

export type ApiSubscriptionLog = {
  id: number;
  createdAt: string;
  subscriptionId: number | null;
  hookId: string | null;
  eventType: string;
  repository: string;
  status: string;
  summary: string;
  payload: string;
  errorMessage: string | null;
};

export type ApiGithubIntegration = {
  status: "success" | "error" | "skipped";
  message?: string;
  hookId?: string;
  hookUrl?: string;
} | null;

export type ApiGithubAccount = {
  username: string | null;
  avatarUrl: string | null;
  scopes: string[];
  updatedAt: string;
};

export type ApiGithubStatus =
  | {
      connected: false;
    }
  | {
      connected: true;
      account: ApiGithubAccount;
    };

export type ApiGithubRepo = {
  id: number;
  name: string;
  fullName: string;
  private: boolean;
  htmlUrl: string;
  description: string | null;
  ownerLogin: string;
};

export type ApiGithubWebhook = {
  id: string;
  url: string;
  events: string[];
  active: boolean;
  name: string | null;
  authorized: boolean;
  subscriptionId: number | null;
  subscriptionHookId: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type ApiGithubRepoWebhookSummary = {
  repoId: number;
  repo: string;
  owner: string;
  webhooks: ApiGithubWebhook[];
  error?: string;
};

export type TelegramAuthPayload = {
  id: number | string;
  auth_date: number | string;
  hash: string;
  username?: string;
  first_name?: string;
  last_name?: string;
  photo_url?: string;
  [key: string]: unknown;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {})
    },
    credentials: "include"
  });
  if (!response.ok) {
    const text = await response.text();
    throw new ApiError(text || `Request failed: ${response.status}`, response.status);
  }
  return response.json() as Promise<T>;
}

export const api = {
  me: () => request<{ user: ApiUser }>("/api/me"),
  bots: {
    list: () => request<{ bots: ApiBot[] }>("/api/bots"),
    create: (payload: { token: string; dropPendingUpdates?: boolean }) =>
      request<{ bot: ApiBot; webhookOk: boolean; webhookInfo: ApiWebhookInfo }>("/api/bots", {
        method: "POST",
        body: JSON.stringify(payload)
      }),
    updateToken: (id: number, payload: { token: string; dropPendingUpdates?: boolean }) =>
      request<{ ok: boolean; webhookOk: boolean; displayName: string; webhookInfo: ApiWebhookInfo }>(
        `/api/bots/${id}/token`,
        { method: "PUT", body: JSON.stringify(payload) }
      ),
    info: (id: number) => request<{ bot: ApiBot; webhookInfo: ApiWebhookInfo }>(`/api/bots/${id}/info`),
    dropPendingUpdates: (id: number) =>
      request<{ ok: boolean; webhookInfo: ApiWebhookInfo }>(`/api/bots/${id}/drop-updates`, {
        method: "POST",
        body: JSON.stringify({})
      }),
    remove: (id: number) => request<{ ok: boolean }>(`/api/bots/${id}`, { method: "DELETE" })
  },
  destinations: {
    list: () => request<{ destinations: ApiDestination[] }>("/api/destinations"),
    create: (payload: { chatId: string; title?: string; isDefault?: boolean; topicId?: number | string | null }) =>
      request<{ destination: ApiDestination }>("/api/destinations", {
        method: "POST",
        body: JSON.stringify(payload)
      }),
    update: (
      id: number,
      payload: { chatId?: string; title?: string; isDefault?: boolean; topicId?: number | string | null }
    ) =>
      request<{ ok: boolean }>(`/api/destinations/${id}`, {
        method: "PUT",
        body: JSON.stringify(payload)
      }),
    setDefault: (id: number) =>
      request<{ ok: boolean }>(`/api/destinations/${id}/default`, { method: "POST", body: JSON.stringify({}) }),
    remove: (id: number) => request<{ ok: boolean }>(`/api/destinations/${id}`, { method: "DELETE" }),
    lookup: {
      start: (payload: { botId: number }) =>
        request<ApiChatLookupStart>("/api/destinations/chat-lookup/start", {
          method: "POST",
          body: JSON.stringify(payload)
        }),
      status: (botId: number) => request<ApiChatLookupStatus>(`/api/destinations/chat-lookup/status?botId=${botId}`),
      reset: (payload: { botId: number }) =>
        request<{ ok: boolean }>("/api/destinations/chat-lookup/reset", {
          method: "POST",
          body: JSON.stringify(payload)
        })
    }
  },
  subscriptions: {
    list: () => request<{ subscriptions: ApiSubscription[] }>("/api/subscriptions"),
    create: (payload: { repo: string; events: string; botId: number; destinationId: number }) =>
      request<{ subscription: ApiSubscription | null; webhook: ApiSubscriptionWebhook; githubIntegration: ApiGithubIntegration }>(
        "/api/subscriptions",
        {
          method: "POST",
          body: JSON.stringify(payload)
        }
      ),
    update: (id: number, payload: { repo: string; events: string; botId: number; destinationId: number }) =>
      request<{ subscription: ApiSubscription | null; githubIntegration: ApiGithubIntegration }>(`/api/subscriptions/${id}`, {
        method: "PUT",
        body: JSON.stringify(payload)
      }),
    remove: (id: number) =>
      request<{ ok: boolean; githubIntegration: ApiGithubIntegration }>(`/api/subscriptions/${id}`, { method: "DELETE" }),
    logs: (id: number) => request<{ logs: ApiSubscriptionLog[] }>(`/api/subscriptions/${id}/logs`)
  },
  events: {
    list: () => request<{ events: string[] }>("/api/events")
  },
  auth: {
    verifyTelegram: (payload: TelegramAuthPayload) =>
      request<{ ok: boolean; user: ApiUser; sessionExpiresAt: string; loggedAt: string }>("/api/auth/telegram/verify", {
        method: "POST",
        body: JSON.stringify(payload)
      }),
    logout: () => request<{ ok: boolean }>("/api/auth/logout", { method: "POST" })
  },
  stats: () =>
    request<{
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
    }>("/api/stats"),
  github: {
    status: () => request<ApiGithubStatus>("/api/github/status"),
    oauthUrl: () => request<{ url: string }>("/api/github/oauth/url"),
    disconnect: () => request<{ ok: boolean }>("/api/github/connection", { method: "DELETE" }),
    repos: (params?: { page?: number; perPage?: number; force?: boolean }) => {
      const searchParams = new URLSearchParams();
      if (params?.page) {
        searchParams.set("page", String(params.page));
      }
      if (params?.perPage) {
        searchParams.set("perPage", String(params.perPage));
      }
       if (params?.force) {
        searchParams.set("force", "true");
      }
      const query = searchParams.toString();
      return request<{ repositories: ApiGithubRepo[]; hasNextPage: boolean; cached?: boolean }>(
        `/api/github/repos${query ? `?${query}` : ""}`
      );
    },
    webhooks: (params?: { perPage?: number; maxPages?: number; force?: boolean }) => {
      const searchParams = new URLSearchParams();
      if (params?.perPage) {
        searchParams.set("perPage", String(params.perPage));
      }
      if (params?.maxPages) {
        searchParams.set("maxPages", String(params.maxPages));
      }
      if (params?.force) {
        searchParams.set("force", "true");
      }
      const query = searchParams.toString();
      return request<{ repositories: ApiGithubRepoWebhookSummary[]; exhausted: boolean; errors: Array<{ repo: string; message: string }>; cached?: boolean }>(
        `/api/github/webhooks${query ? `?${query}` : ""}`
      );
    }
  }
};
