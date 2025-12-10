import { getAuthenticatedUser, unauthorized } from "@/lib/auth";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getAuthenticatedUser();
  if (!user) {
    return unauthorized();
  }
  return NextResponse.json({
    user: {
      id: user.id,
      username: user.username,
      telegramUserId: user.telegramUserId,
      isAdmin: Boolean(user.isAdmin)
    }
  });
}
