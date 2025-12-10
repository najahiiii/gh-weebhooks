import { getAuthenticatedUser } from "@/lib/auth";
import { ensureGithubConfigured, renderResultPage } from "@/lib/githubIntegration";
import { saveGithubAccount } from "@/lib/services/githubAccounts";
import { exchangeCodeForToken, fetchViewer, GithubApiError } from "@/lib/services/githubApi";
import { consumeOauthState } from "@/lib/services/githubOauthState";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getAuthenticatedUser();
  const url = new URL(request.url);
  const code = url.searchParams.get("code") || undefined;
  const state = url.searchParams.get("state") || undefined;
  const error = url.searchParams.get("error") || undefined;
  const errorDescription = url.searchParams.get("error_description") || undefined;

  if (!user) {
    return new NextResponse(
      renderResultPage({
        status: "error",
        message: "Session expired. Please log in again before connecting GitHub."
      }),
      { status: 401, headers: { "Content-Type": "text/html; charset=utf-8" } }
    );
  }
  if (error) {
    return new NextResponse(
      renderResultPage({
        status: "error",
        message: `GitHub authorization failed: ${errorDescription || error}`
      }),
      { status: 400, headers: { "Content-Type": "text/html; charset=utf-8" } }
    );
  }
  if (!code || !state) {
    return new NextResponse(renderResultPage({ status: "error", message: "Missing code or state from GitHub." }), {
      status: 400,
      headers: { "Content-Type": "text/html; charset=utf-8" }
    });
  }
  if (!consumeOauthState(user.id, state)) {
    return new NextResponse(
      renderResultPage({ status: "error", message: "OAuth state mismatch. Please try again." }),
      { status: 400, headers: { "Content-Type": "text/html; charset=utf-8" } }
    );
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
    return new NextResponse(
      renderResultPage({
        status: "success",
        message: `Connected as ${account.username || "GitHub user"}.`
      }),
      { headers: { "Content-Type": "text/html; charset=utf-8" } }
    );
  } catch (err) {
    let message = "Failed to complete GitHub connection.";
    if (err instanceof GithubApiError) {
      message = err.message;
    } else if (err instanceof Error) {
      message = err.message;
    }
    return new NextResponse(renderResultPage({ status: "error", message }), {
      status: 400,
      headers: { "Content-Type": "text/html; charset=utf-8" }
    });
  }
}
