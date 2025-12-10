import { getAuthenticatedUser, unauthorized } from "@/lib/auth";
import {
  CachedReposPayload,
  isCacheFresh,
  makeCacheKey,
  parseForceFlag,
  reposCache
} from "@/lib/githubIntegration";
import { getGithubAccount } from "@/lib/services/githubAccounts";
import { fetchRepositories, GithubApiError } from "@/lib/services/githubApi";
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
    return NextResponse.json({ error: "Connect GitHub first to fetch repositories." }, { status: 400 });
  }
  const page = Number.parseInt(String(request.nextUrl.searchParams.get("page") || "1"), 10);
  const perPage = Number.parseInt(String(request.nextUrl.searchParams.get("perPage") || "100"), 10);
  const force = parseForceFlag(request.nextUrl.searchParams.get("force"));
  const cacheKey = makeCacheKey("repos", user.id, [page, perPage]);

  if (!force) {
    const cached = reposCache.get(cacheKey);
    if (cached && isCacheFresh(cached)) {
      return NextResponse.json({ ...(cached.data as CachedReposPayload), cached: true });
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
    return NextResponse.json({ ...payload, cached: false });
  } catch (err) {
    if (err instanceof GithubApiError) {
      return NextResponse.json({ error: err.message }, { status: err.status || 500 });
    }
    console.error(err);
    return NextResponse.json({ error: "Failed to fetch repositories" }, { status: 500 });
  }
}
