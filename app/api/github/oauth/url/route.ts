import { getAuthenticatedUser, unauthorized } from "@/lib/auth";
import { randomToken } from "@/lib/crypto";
import { buildConnectUrl, ensureGithubConfigured } from "@/lib/githubIntegration";
import { createOauthState } from "@/lib/services/githubOauthState";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getAuthenticatedUser();
  if (!user) {
    return unauthorized();
  }
  try {
    ensureGithubConfigured();
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
  const state = randomToken(24);
  createOauthState(user.id, state);
  const url = buildConnectUrl(state);
  return NextResponse.json({ url });
}
