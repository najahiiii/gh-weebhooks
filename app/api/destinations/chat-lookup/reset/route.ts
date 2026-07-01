import { getAuthenticatedUser, unauthorized } from "@/lib/auth";
import { getBot } from "@/lib/services/bots";
import { clearChatLookup } from "@/lib/services/telegramLookup";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return unauthorized();
  }
  const body = await request.json().catch((): unknown => ({}));
  const botIdRaw =
    body && typeof body === "object" && "botId" in body
      ? body.botId
      : request.nextUrl.searchParams.get("botId");
  const botId = Number.parseInt(String(botIdRaw || ""), 10);
  if (Number.isNaN(botId)) {
    return NextResponse.json({ error: "Invalid bot id" }, { status: 400 });
  }
  const bot = getBot(botId);
  if (!bot || bot.ownerUserId !== user.id) {
    return NextResponse.json({ error: "Bot not found" }, { status: 404 });
  }
  clearChatLookup(user.id, bot.botId);
  return NextResponse.json({ ok: true });
}
