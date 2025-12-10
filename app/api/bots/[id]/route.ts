import { getAuthenticatedUser, unauthorized } from "@/lib/auth";
import { deleteBot, getBot } from "@/lib/services/bots";
import { countSubscriptionsForBot } from "@/lib/services/subscriptions";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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
  const activeSubs = countSubscriptionsForBot(bot.id);
  if (activeSubs > 0) {
    return NextResponse.json(
      {
        error: "bot_has_subscriptions",
        message: "Remove subscriptions linked to this bot before deleting it."
      },
      { status: 409 }
    );
  }
  deleteBot(bot.id);
  return NextResponse.json({ ok: true });
}
