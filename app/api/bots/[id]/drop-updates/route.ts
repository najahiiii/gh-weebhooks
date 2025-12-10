import { getAuthenticatedUser, unauthorized } from "@/lib/auth";
import { config } from "@/lib/config";
import { getBot } from "@/lib/services/bots";
import { fetchTelegramWebhookInfo, setTelegramWebhook } from "@/lib/services/telegram";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
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
  const webhookUrl = `${config.publicBaseUrl.replace(/\/$/, "")}/tg/${bot.botId}/${encodeURIComponent(bot.token)}`;
  const webhookOk = await setTelegramWebhook(bot.token, webhookUrl, { dropPendingUpdates: true });
  const webhookInfo = await fetchTelegramWebhookInfo(bot.token);
  return NextResponse.json({ ok: webhookOk, webhookInfo });
}
