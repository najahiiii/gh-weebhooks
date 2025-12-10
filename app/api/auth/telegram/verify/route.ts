import { config } from "@/lib/config";
import { verifyTelegramLogin } from "@/lib/crypto";
import { createSession } from "@/lib/services/sessions";
import { ensureUserByTelegramId } from "@/lib/services/users";
import { nowIsoWithTimezone } from "@/lib/time";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const telegramPayloadSchema = z.object({
  id: z.union([z.number(), z.string()]),
  auth_date: z.union([z.number(), z.string()]),
  hash: z.string(),
  username: z.string().optional(),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  photo_url: z.string().optional()
});

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!config.loginBotToken) {
    return NextResponse.json({ error: "Telegram login not configured" }, { status: 503 });
  }
  const parseResult = telegramPayloadSchema.safeParse(await request.json());
  if (!parseResult.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }
  const payload = parseResult.data;
  const rawPayload = payload as unknown as Record<string, unknown>;
  if (!verifyTelegramLogin(rawPayload, config.loginBotToken)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  const telegramId = String(payload.id);
  const promoteToAdmin = config.adminIds.includes(telegramId);
  const user = ensureUserByTelegramId(telegramId, payload.username, promoteToAdmin);
  const session = createSession(user.id, config.sessionDurationHours);

  const response = NextResponse.json({
    ok: true,
    user: {
      id: user.id,
      username: user.username,
      telegramUserId: user.telegramUserId,
      isAdmin: user.isAdmin
    },
    sessionExpiresAt: session.expiresAt,
    loggedAt: nowIsoWithTimezone()
  });

  response.cookies.set(config.sessionCookieName, session.token, {
    maxAge: config.sessionDurationHours * 3600,
    httpOnly: true,
    sameSite: "lax",
    secure: config.publicBaseUrl.startsWith("https://")
  });

  return response;
}
