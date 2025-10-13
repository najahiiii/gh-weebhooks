import { Router } from "express";
import { z } from "zod";
import { config } from "../config";
import { ensureUserByTelegramId } from "../services/users";
import { createSession, revokeSession } from "../services/sessions";
import { verifyTelegramLogin } from "../utils/crypto";
import { nowIsoWithTimezone } from "../utils/time";

const router = Router();

const telegramPayloadSchema = z.object({
  id: z.union([z.number(), z.string()]),
  auth_date: z.union([z.number(), z.string()]),
  hash: z.string(),
  username: z.string().optional(),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  photo_url: z.string().optional()
});

router.post("/telegram/verify", (req, res) => {
  if (!config.loginBotToken) {
    return res.status(503).json({ error: "Telegram login not configured" });
  }
  const parseResult = telegramPayloadSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: "Invalid payload" });
  }
  const payload = parseResult.data;
  const rawPayload = payload as unknown as Record<string, unknown>;
  if (!verifyTelegramLogin(rawPayload, config.loginBotToken)) {
    return res.status(400).json({ error: "Invalid signature" });
  }

  const telegramId = String(payload.id);
  const promoteToAdmin = config.adminIds.includes(telegramId);
  const user = ensureUserByTelegramId(telegramId, payload.username, promoteToAdmin);
  const session = createSession(user.id, config.sessionDurationHours);

  res.cookie(config.sessionCookieName, session.token, {
    maxAge: config.sessionDurationHours * 3600 * 1000,
    httpOnly: true,
    sameSite: "lax",
    secure: config.publicBaseUrl.startsWith("https://")
  });

  return res.json({
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
});

router.post("/logout", (req, res) => {
  const token = req.cookies?.[config.sessionCookieName];
  if (token) {
    revokeSession(token);
    res.clearCookie(config.sessionCookieName);
  }
  return res.json({ ok: true });
});

export default router;
