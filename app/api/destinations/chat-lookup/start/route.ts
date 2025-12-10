import { getAuthenticatedUser, unauthorized } from "@/lib/auth";
import { getBot } from "@/lib/services/bots";
import { startChatLookup } from "@/lib/services/telegramLookup";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const chatLookupStartSchema = z.object({ botId: z.number() });

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return unauthorized();
  }
  const parseResult = chatLookupStartSchema.safeParse(await request.json());
  if (!parseResult.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }
  const { botId } = parseResult.data;
  const bot = getBot(botId);
  if (!bot || bot.ownerUserId !== user.id) {
    return NextResponse.json({ error: "Bot not found" }, { status: 404 });
  }
  const state = startChatLookup(user.id, bot.id, bot.botId);

  return NextResponse.json({
    status: "pending",
    expiresAt: new Date(state.expiresAt).toISOString()
  });
}
