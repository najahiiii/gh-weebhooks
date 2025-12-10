import { getAuthenticatedUser, unauthorized } from "@/lib/auth";
import { getGithubAccount } from "@/lib/services/githubAccounts";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getAuthenticatedUser();
  if (!user) {
    return unauthorized();
  }
  const account = getGithubAccount(user.id);
  if (!account) {
    return NextResponse.json({ connected: false });
  }
  return NextResponse.json({
    connected: true,
    account: {
      username: account.username,
      avatarUrl: account.avatarUrl,
      scopes: account.scopes,
      updatedAt: account.updatedAt
    }
  });
}
