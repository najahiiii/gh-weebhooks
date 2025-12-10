import { config } from "lib/config";

export type CachedEntry<T> = {
  data: T;
  fetchedAt: number;
};

export const reposCache = new Map<string, CachedEntry<unknown>>();
export const webhooksCache = new Map<string, CachedEntry<unknown>>();

export type RepoSummary = {
  id: number;
  name: string;
  fullName: string;
  private: boolean;
  htmlUrl: string;
  description: string | null;
  ownerLogin: string;
};

export type CachedReposPayload = {
  repositories: RepoSummary[];
  hasNextPage: boolean;
};

export type CachedWebhooksPayload = {
  repositories: Array<{
    repoId: number;
    repo: string;
    owner: string;
    webhooks: Array<{
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
    }>;
    error?: string;
  }>;
  exhausted: boolean;
  errors: Array<{ repo: string; message: string }>;
};

const GITHUB_CACHE_TTL_MS = 5 * 60 * 1000;

export function makeCacheKey(prefix: string, userId: number, components: Array<string | number>): string {
  return `${prefix}:${userId}:${components.join(":")}`;
}

export function isCacheFresh(entry: CachedEntry<unknown>): boolean {
  return Date.now() - entry.fetchedAt < GITHUB_CACHE_TTL_MS;
}

export function clearGithubCacheForUser(userId: number): void {
  const reposPrefix = `repos:${userId}:`;
  for (const key of reposCache.keys()) {
    if (key.startsWith(reposPrefix)) {
      reposCache.delete(key);
    }
  }
  const webhookPrefix = `webhooks:${userId}:`;
  for (const key of webhooksCache.keys()) {
    if (key.startsWith(webhookPrefix)) {
      webhooksCache.delete(key);
    }
  }
}

export function parseForceFlag(value: unknown): boolean {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized === "true" || normalized === "1" || normalized === "yes";
  }
  if (typeof value === "number") {
    return value === 1;
  }
  return Boolean(value);
}

export function ensureGithubConfigured(): void {
  if (!config.githubClientId || !config.githubClientSecret) {
    throw new Error("GitHub OAuth is not configured.");
  }
}

export function buildConnectUrl(state: string): string {
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", config.githubClientId);
  url.searchParams.set("scope", config.githubScopes);
  url.searchParams.set("state", state);
  url.searchParams.set("allow_signup", "false");
  url.searchParams.set("redirect_uri", `${config.publicBaseUrl}/api/github/oauth/callback`);
  return url.toString();
}

export function renderResultPage(result: { status: "success" | "error"; message: string }): string {
  const targetOrigin = JSON.stringify(new URL(config.frontendBaseUrl).origin);
  const payload = JSON.stringify(result);
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>GitHub connection</title>
    <style>
      body { font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #020617; color: #e2e8f0; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
      .card { background: rgba(15,23,42,0.9); border: 1px solid rgba(148,163,184,0.2); border-radius: 16px; padding: 24px; max-width: 360px; text-align: center; box-shadow: 0 20px 45px rgba(2,6,23,0.6); }
      h1 { font-size: 1.25rem; margin-bottom: 0.75rem; }
      p { font-size: 0.95rem; line-height: 1.4; }
      .status-success { color: #34d399; }
      .status-error { color: #f87171; }
      button { margin-top: 1.5rem; padding: 0.5rem 1.25rem; border-radius: 9999px; border: none; cursor: pointer; font-weight: 600; background: rgba(56,189,248,0.2); color: #e0f2fe; }
      button:hover { background: rgba(56,189,248,0.35); }
    </style>
  </head>
  <body>
    <div class="card">
      <h1 class="status-${result.status}">${result.status === "success" ? "Connected!" : "Something went wrong"}</h1>
      <p>${result.message}</p>
      <button type="button" onclick="window.close()">Close</button>
    </div>
    <script>
      (function() {
        try {
          if (window.opener && typeof window.opener.postMessage === "function") {
            window.opener.postMessage({ source: "github-oauth", ...${payload} }, ${targetOrigin});
          }
        } catch (err) {
          console.error("Failed to notify opener about GitHub OAuth result", err);
        }
      })();
    </script>
  </body>
</html>`;
}
