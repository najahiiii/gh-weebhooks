import { getAuthenticatedUser, unauthorized } from "@/lib/auth";
import { config } from "@/lib/config";
import { createBot, listBots, type Bot as BotRecord } from "@/lib/services/bots";
import { fetchTelegramBotLabel, fetchTelegramWebhookInfo, setTelegramWebhook } from "@/lib/services/telegram";
import { parseBotIdFromToken } from "@/lib/telegram";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const botLabelCache = new Map<number, string>();

async function resolveBotLabel(bot: BotRecord): Promise<string> {
  const cached = botLabelCache.get(bot.id);
  if (cached) {
    return cached;
  }
  const label = await fetchTelegramBotLabel(bot.token);
  const displayName = label || bot.botId;
  botLabelCache.set(bot.id, displayName);
  return displayName;
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getAuthenticatedUser();
  if (!user) {
    return unauthorized();
  }
  const bots = listBots(user.id);
  const enriched = await Promise.all(
    bots.map(async (bot) => ({
      ...bot,
      displayName: await resolveBotLabel(bot)
    }))
  );
  return NextResponse.json({ bots: enriched });
}

const createSchema = z.object({
  token: z.string().min(10),
  dropPendingUpdates: z.boolean().optional()
});

export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return unauthorized();
  }
  const parseResult = createSchema.safeParse(await request.json());
  if (!parseResult.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }
  const { token, dropPendingUpdates } = parseResult.data;
  const botId = parseBotIdFromToken(token);
  if (!botId) {
    return NextResponse.json({ error: "Invalid Telegram bot token" }, { status: 400 });
  }
  const bot = createBot(user.id, botId, token);
  const webhookUrl = `${config.publicBaseUrl.replace(/\/$/, "")}/tg/${bot.botId}/${encodeURIComponent(token)}`;
  const webhookOk = await setTelegramWebhook(token, webhookUrl, { dropPendingUpdates });
  const displayName = await resolveBotLabel(bot);
  const webhookInfo = await fetchTelegramWebhookInfo(token);
  return NextResponse.json({ bot: { ...bot, displayName }, webhookOk, webhookInfo }, { status: 201 });
}
