import { getAuthenticatedUser, unauthorized } from "@/lib/auth";
import { config } from "@/lib/config";
import { getBot, updateBotToken } from "@/lib/services/bots";
import { fetchTelegramBotLabel, fetchTelegramWebhookInfo, setTelegramWebhook } from "@/lib/services/telegram";
import { parseBotIdFromToken } from "@/lib/telegram";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const updateSchema = z.object({
  token: z.string().min(10),
  dropPendingUpdates: z.boolean().optional()
});

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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
  const parseResult = updateSchema.safeParse(await request.json());
  if (!parseResult.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }
  const { token, dropPendingUpdates } = parseResult.data;
  const botId = parseBotIdFromToken(token);
  if (!botId || botId !== bot.botId) {
    return NextResponse.json({ error: "Token does not match bot" }, { status: 400 });
  }
  updateBotToken(bot.id, token);
  const webhookUrl = `${config.publicBaseUrl.replace(/\/$/, "")}/tg/${bot.botId}/${encodeURIComponent(token)}`;
  const webhookOk = await setTelegramWebhook(token, webhookUrl, { dropPendingUpdates });
  const displayName = (await fetchTelegramBotLabel(token)) || bot.botId;
  const webhookInfo = await fetchTelegramWebhookInfo(token);
  return NextResponse.json({ ok: true, webhookOk, displayName, webhookInfo });
}
