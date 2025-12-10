import { getAuthenticatedUser, unauthorized } from "@/lib/auth";
import { clearGithubCacheForUser } from "@/lib/githubIntegration";
import { deleteGithubAccount } from "@/lib/services/githubAccounts";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE() {
  const user = await getAuthenticatedUser();
  if (!user) {
    return unauthorized();
  }
  deleteGithubAccount(user.id);
  clearGithubCacheForUser(user.id);
  return NextResponse.json({ ok: true });
}
