import { getAuthenticatedUser, unauthorized } from "@/lib/auth";
import { getBot } from "@/lib/services/bots";
import { fetchTelegramBotLabel, fetchTelegramWebhookInfo } from "@/lib/services/telegram";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return unauthorized();
  }
  const { id: rawId } = await params;
  const id = Number.parseInt(rawId, 10);
  if (Number.isNaN(id)) {
    return NextResponse.json({ error: "Bot not found" }, { status: 404 });
  }
  const bot = getBot(id);
  if (!bot || bot.ownerUserId !== user.id) {
    return NextResponse.json({ error: "Bot not found" }, { status: 404 });
  }
  const info = await fetchTelegramWebhookInfo(bot.token);
  const displayName = (await fetchTelegramBotLabel(bot.token)) || bot.botId;
  return NextResponse.json({ bot: { ...bot, displayName }, webhookInfo: info });
}
