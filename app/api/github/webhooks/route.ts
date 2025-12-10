import { getAuthenticatedUser, unauthorized } from "@/lib/auth";
import { config } from "@/lib/config";
import {
  CachedWebhooksPayload,
  ensureGithubConfigured,
  isCacheFresh,
  makeCacheKey,
  parseForceFlag,
  webhooksCache
} from "@/lib/githubIntegration";
import { getGithubAccount } from "@/lib/services/githubAccounts";
import { fetchRepositories, GithubApiError, listRepoWebhooks } from "@/lib/services/githubApi";
import { listSubscriptions } from "@/lib/services/subscriptions";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return unauthorized();
  }
  const account = getGithubAccount(user.id);
  if (!account) {
    return NextResponse.json({ error: "Connect GitHub first to inspect webhooks." }, { status: 400 });
  }
  try {
    ensureGithubConfigured();
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }

  const perPage = Math.min(Math.max(Number.parseInt(String(request.nextUrl.searchParams.get("perPage") || "50"), 10), 1), 100);
  const maxPages = Math.min(
    Math.max(Number.parseInt(String(request.nextUrl.searchParams.get("maxPages") || "10"), 10), 1),
    25
  );
  const force = parseForceFlag(request.nextUrl.searchParams.get("force"));
  const cacheKey = makeCacheKey("webhooks", user.id, [perPage, maxPages]);

  if (!force) {
    const cached = webhooksCache.get(cacheKey);
    if (cached && isCacheFresh(cached)) {
      return NextResponse.json({ ...(cached.data as CachedWebhooksPayload), cached: true });
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

  const repositories: CachedWebhooksPayload["repositories"] = [];
  const errors: Array<{ repo: string; message: string }> = [];

  let page = 1;
  let hasNextPage = true;
  while (hasNextPage && page <= maxPages) {
    let repoBatch;
    try {
      repoBatch = await fetchRepositories(account.accessToken, { perPage, page });
    } catch (err) {
      if (err instanceof GithubApiError) {
        return NextResponse.json({ error: err.message }, { status: err.status || 500 });
      }
      console.error(err);
      return NextResponse.json({ error: "Failed to fetch repositories" }, { status: 500 });
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

  return NextResponse.json({ ...payload, cached: false });
}
