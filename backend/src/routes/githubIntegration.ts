import { Router } from "express";
import { config } from "../config";
import { requireAuth } from "../middleware/session";
import { createOauthState, consumeOauthState } from "../services/githubOauthState";
import { randomToken } from "../utils/crypto";
import {
  deleteGithubAccount,
  getGithubAccount,
  saveGithubAccount
} from "../services/githubAccounts";
import {
  exchangeCodeForToken,
  fetchRepositories,
  fetchViewer,
  GithubApiError,
  listRepoWebhooks
} from "../services/githubApi";
import { listSubscriptions } from "../services/subscriptions";

const router = Router();

type CachedEntry<T> = {
  data: T;
  fetchedAt: number;
};

type RepoSummary = {
  id: number;
  name: string;
  fullName: string;
  private: boolean;
  htmlUrl: string;
  description: string | null;
  ownerLogin: string;
};

type CachedReposPayload = {
  repositories: RepoSummary[];
  hasNextPage: boolean;
};

type CachedWebhooksPayload = {
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
const reposCache = new Map<string, CachedEntry<CachedReposPayload>>();
const webhooksCache = new Map<string, CachedEntry<CachedWebhooksPayload>>();

function makeCacheKey(prefix: string, userId: number, components: Array<string | number>): string {
  return `${prefix}:${userId}:${components.join(":")}`;
}

function isCacheFresh(entry: CachedEntry<unknown>): boolean {
  return Date.now() - entry.fetchedAt < GITHUB_CACHE_TTL_MS;
}

function clearGithubCacheForUser(userId: number): void {
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

function parseForceFlag(value: unknown): boolean {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized === "true" || normalized === "1" || normalized === "yes";
  }
  if (typeof value === "number") {
    return value === 1;
  }
  return Boolean(value);
}

function ensureGithubConfigured(): void {
  if (!config.githubClientId || !config.githubClientSecret) {
    throw new Error("GitHub OAuth is not configured.");
  }
}

function buildConnectUrl(state: string): string {
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", config.githubClientId);
  url.searchParams.set("scope", config.githubScopes);
  url.searchParams.set("state", state);
  url.searchParams.set("allow_signup", "false");
  url.searchParams.set("redirect_uri", `${config.publicBaseUrl}/api/github/oauth/callback`);
  return url.toString();
}

function renderResultPage(result: { status: "success" | "error"; message: string }): string {
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

router.get("/status", requireAuth, (req, res) => {
  const user = (req as any).user;
  const account = getGithubAccount(user.id);
  if (!account) {
    return res.json({ connected: false });
  }
  return res.json({
    connected: true,
    account: {
      username: account.username,
      avatarUrl: account.avatarUrl,
      scopes: account.scopes,
      updatedAt: account.updatedAt
    }
  });
});

router.get("/oauth/url", requireAuth, (req, res) => {
  try {
    ensureGithubConfigured();
  } catch (error) {
    return res.status(400).json({ error: (error as Error).message });
  }
  const user = (req as any).user;
  const state = randomToken(24);
  createOauthState(user.id, state);
  const url = buildConnectUrl(state);
  return res.json({ url });
});

router.get("/oauth/callback", async (req, res) => {
  const user = (req as any).user;
  const { code, state, error, error_description: errorDescription } = req.query as Record<string, string | undefined>;

  if (!user) {
    res.status(401).send(renderResultPage({ status: "error", message: "Session expired. Please log in again before connecting GitHub." }));
    return;
  }
  if (error) {
    res.status(400).send(
      renderResultPage({
        status: "error",
        message: `GitHub authorization failed: ${errorDescription || error}`
      })
    );
    return;
  }
  if (!code || !state) {
    res.status(400).send(renderResultPage({ status: "error", message: "Missing code or state from GitHub." }));
    return;
  }
  if (!consumeOauthState(user.id, state)) {
    res.status(400).send(renderResultPage({ status: "error", message: "OAuth state mismatch. Please try again." }));
    return;
  }
  try {
    ensureGithubConfigured();
    const { accessToken, scope, tokenType } = await exchangeCodeForToken(code);
    const viewer = await fetchViewer(accessToken);
    const account = saveGithubAccount({
      userId: user.id,
      accessToken,
      username: viewer.login || null,
      avatarUrl: viewer.avatar_url || null,
      scopes: scope,
      tokenType
    });
    res.send(
      renderResultPage({
        status: "success",
        message: `Connected as ${account.username || "GitHub user"}. You may close this window.`
      })
    );
  } catch (err) {
    let message = "Failed to complete GitHub connection.";
    if (err instanceof GithubApiError) {
      message = err.message;
    } else if (err instanceof Error) {
      message = err.message;
    }
    res.status(400).send(renderResultPage({ status: "error", message }));
  }
});

router.delete("/connection", requireAuth, (req, res) => {
  const user = (req as any).user;
  deleteGithubAccount(user.id);
  clearGithubCacheForUser(user.id);
  return res.json({ ok: true });
});

router.get("/repos", requireAuth, async (req, res) => {
  const user = (req as any).user;
  const account = getGithubAccount(user.id);
  if (!account) {
    return res.status(400).json({ error: "Connect GitHub first to fetch repositories." });
  }
  const page = Number.parseInt(String(req.query.page || "1"), 10);
  const perPage = Number.parseInt(String(req.query.perPage || "100"), 10);
  const force = parseForceFlag(req.query.force);
  const cacheKey = makeCacheKey("repos", user.id, [page, perPage]);

  if (!force) {
    const cached = reposCache.get(cacheKey);
    if (cached && isCacheFresh(cached)) {
      return res.json({ ...cached.data, cached: true });
    }
    if (cached && !isCacheFresh(cached)) {
      reposCache.delete(cacheKey);
    }
  }
  try {
    const result = await fetchRepositories(account.accessToken, {
      perPage: Math.min(Math.max(perPage, 1), 100),
      page: Math.max(page, 1)
    });
    const payload: CachedReposPayload = {
      repositories: result.repositories.map((repo) => ({
        id: repo.id,
        name: repo.name,
        fullName: repo.full_name,
        private: repo.private,
        htmlUrl: repo.html_url,
        description: repo.description,
        ownerLogin: repo.owner?.login ?? ""
      })),
      hasNextPage: result.hasNextPage
    };
    reposCache.set(cacheKey, { data: payload, fetchedAt: Date.now() });
    return res.json({ ...payload, cached: false });
  } catch (err) {
    if (err instanceof GithubApiError) {
      return res.status(err.status || 500).json({ error: err.message });
    }
    console.error(err);
    return res.status(500).json({ error: "Failed to fetch repositories" });
  }
});

router.get("/webhooks", requireAuth, async (req, res) => {
  const user = (req as any).user;
  const account = getGithubAccount(user.id);
  if (!account) {
    return res.status(400).json({ error: "Connect GitHub first to inspect webhooks." });
  }
  try {
    ensureGithubConfigured();
  } catch (error) {
    return res.status(400).json({ error: (error as Error).message });
  }

  const perPage = Math.min(Math.max(Number.parseInt(String(req.query.perPage || "50"), 10), 1), 100);
  const maxPages = Math.min(Math.max(Number.parseInt(String(req.query.maxPages || "10"), 10), 1), 25);
  const force = parseForceFlag(req.query.force);
  const cacheKey = makeCacheKey("webhooks", user.id, [perPage, maxPages]);

  if (!force) {
    const cached = webhooksCache.get(cacheKey);
    if (cached && isCacheFresh(cached)) {
      return res.json({ ...cached.data, cached: true });
    }
    if (cached && !isCacheFresh(cached)) {
      webhooksCache.delete(cacheKey);
    }
  }

  const subscriptions = listSubscriptions(user.id);
  const subscriptionsByRepo = new Map<string, typeof subscriptions>();
  subscriptions.forEach((sub) => {
    const repoSubs = subscriptionsByRepo.get(sub.repo);
    if (repoSubs) {
      repoSubs.push(sub);
    } else {
      subscriptionsByRepo.set(sub.repo, [sub]);
    }
  });

  const repositories: Array<{
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
  }> = [];
  const errors: Array<{ repo: string; message: string }> = [];

  let page = 1;
  let hasNextPage = true;
  while (hasNextPage && page <= maxPages) {
    let repoBatch;
    try {
      repoBatch = await fetchRepositories(account.accessToken, { perPage, page });
    } catch (err) {
      if (err instanceof GithubApiError) {
        return res.status(err.status || 500).json({ error: err.message });
      }
      console.error(err);
      return res.status(500).json({ error: "Failed to fetch repositories" });
    }

    for (const repo of repoBatch.repositories) {
      let hooks;
      try {
        hooks = await listRepoWebhooks(account.accessToken, repo.owner?.login || repo.full_name.split("/")[0], repo.name);
      } catch (err) {
        const message = err instanceof GithubApiError ? err.message : "Failed to fetch webhooks";
        repositories.push({
          repoId: repo.id,
          repo: repo.full_name,
          owner: repo.owner?.login ?? "",
          webhooks: [],
          error: message
        });
        errors.push({ repo: repo.full_name, message });
        continue;
      }

      const repoSubscriptions = subscriptionsByRepo.get(repo.full_name) ?? [];
      const normalizedHooks = hooks.map((hook) => {
        const hookId = hook && hook.id !== undefined ? String(hook.id) : "";
        const hookUrl = hook?.config?.url ?? "";
        let authorized = false;
        let subscriptionId: number | null = null;
        let subscriptionHookId: string | null = null;
        for (const sub of repoSubscriptions) {
          const matchesId = sub.githubHookId ? hookId === sub.githubHookId : false;
          const expectedUrl = `${config.publicBaseUrl}/wh/${sub.hookId}`;
          const matchesUrl = hookUrl === expectedUrl;
          if (matchesId || matchesUrl) {
            authorized = true;
            subscriptionId = sub.id;
            subscriptionHookId = sub.hookId;
            break;
          }
        }
        return {
          id: hookId,
          url: hookUrl,
          events: Array.isArray(hook?.events) ? hook.events : [],
          active: Boolean(hook?.active),
          name: hook?.name ?? null,
          authorized,
          subscriptionId,
          subscriptionHookId,
          createdAt: hook?.created_at ?? null,
          updatedAt: hook?.updated_at ?? null
        };
      });

      repositories.push({
        repoId: repo.id,
        repo: repo.full_name,
        owner: repo.owner?.login ?? "",
        webhooks: normalizedHooks
      });
    }

    hasNextPage = repoBatch.hasNextPage;
    page += 1;
  }

  const payload: CachedWebhooksPayload = {
    repositories,
    exhausted: hasNextPage,
    errors
  };

  webhooksCache.set(cacheKey, { data: payload, fetchedAt: Date.now() });

  return res.json({ ...payload, cached: false });
});

export default router;
