import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/session";
import {
  createBot,
  deleteBot,
  listBots,
  updateBotToken,
  getBot,
  type Bot as BotRecord
} from "../services/bots";
import { parseBotIdFromToken } from "../utils/telegram";
import { config } from "../config";
import { setTelegramWebhook, fetchTelegramBotLabel, fetchTelegramWebhookInfo } from "../services/telegram";
import { countSubscriptionsForBot } from "../services/subscriptions";

const router = Router();
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

router.get("/", requireAuth, async (req, res) => {
  const user = (req as any).user;
  const bots = listBots(user.id);
  const enriched = await Promise.all(
    bots.map(async (bot) => ({
      ...bot,
      displayName: await resolveBotLabel(bot)
    }))
  );
  return res.json({ bots: enriched });
});

const createSchema = z.object({
  token: z.string().min(10),
  dropPendingUpdates: z.boolean().optional()
});

router.post("/", requireAuth, async (req, res) => {
  const user = (req as any).user;
  const parseResult = createSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: "Invalid payload" });
  }
  const { token, dropPendingUpdates } = parseResult.data;
  const botId = parseBotIdFromToken(token);
  if (!botId) {
    return res.status(400).json({ error: "Invalid Telegram bot token" });
  }
  const bot = createBot(user.id, botId, token);
  const webhookUrl = `${config.publicBaseUrl.replace(/\/$/, "")}/tg/${bot.botId}/${encodeURIComponent(token)}`;
  const webhookOk = await setTelegramWebhook(token, webhookUrl, { dropPendingUpdates });
  const displayName = await resolveBotLabel(bot);
  const webhookInfo = await fetchTelegramWebhookInfo(token);
  return res.status(201).json({ bot: { ...bot, displayName }, webhookOk, webhookInfo });
});

const updateSchema = z.object({
  token: z.string().min(10),
  dropPendingUpdates: z.boolean().optional()
});

router.put("/:id/token", requireAuth, async (req, res) => {
  const user = (req as any).user;
  const id = Number.parseInt(req.params.id, 10);
  if (Number.isNaN(id)) {
    return res.status(404).json({ error: "Bot not found" });
  }
  const bot = getBot(id);
  if (!bot || bot.ownerUserId !== user.id) {
    return res.status(404).json({ error: "Bot not found" });
  }
  const parseResult = updateSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: "Invalid payload" });
  }
  const { token, dropPendingUpdates } = parseResult.data;
  const botId = parseBotIdFromToken(token);
  if (!botId || botId !== bot.botId) {
    return res.status(400).json({ error: "Token does not match bot" });
  }
  updateBotToken(bot.id, token);
  botLabelCache.delete(bot.id);
  const webhookUrl = `${config.publicBaseUrl.replace(/\/$/, "")}/tg/${bot.botId}/${encodeURIComponent(token)}`;
  const webhookOk = await setTelegramWebhook(token, webhookUrl, { dropPendingUpdates });
  const displayName = await resolveBotLabel({ ...bot, token });
  const webhookInfo = await fetchTelegramWebhookInfo(token);
  return res.json({ ok: true, webhookOk, displayName, webhookInfo });
});

router.post("/:id/drop-updates", requireAuth, async (req, res) => {
  const user = (req as any).user;
  const id = Number.parseInt(req.params.id, 10);
  if (Number.isNaN(id)) {
    return res.status(404).json({ error: "Bot not found" });
  }
  const bot = getBot(id);
  if (!bot || bot.ownerUserId !== user.id) {
    return res.status(404).json({ error: "Bot not found" });
  }
  const webhookUrl = `${config.publicBaseUrl.replace(/\/$/, "")}/tg/${bot.botId}/${encodeURIComponent(bot.token)}`;
  const webhookOk = await setTelegramWebhook(bot.token, webhookUrl, { dropPendingUpdates: true });
  const webhookInfo = await fetchTelegramWebhookInfo(bot.token);
  return res.json({ ok: webhookOk, webhookInfo });
});

router.delete("/:id", requireAuth, (req, res) => {
  const user = (req as any).user;
  const id = Number.parseInt(req.params.id, 10);
  if (Number.isNaN(id)) {
    return res.status(404).json({ error: "Bot not found" });
  }
  const bot = getBot(id);
  if (!bot || bot.ownerUserId !== user.id) {
    return res.status(404).json({ error: "Bot not found" });
  }
  const activeSubs = countSubscriptionsForBot(bot.id);
  if (activeSubs > 0) {
    return res.status(409).json({
      error: "bot_has_subscriptions",
      message: "Remove subscriptions linked to this bot before deleting it."
    });
  }
  deleteBot(bot.id);
  botLabelCache.delete(bot.id);
  return res.json({ ok: true });
});

router.get("/:id/info", requireAuth, async (req, res) => {
  const user = (req as any).user;
  const id = Number.parseInt(req.params.id, 10);
  if (Number.isNaN(id)) {
    return res.status(404).json({ error: "Bot not found" });
  }
  const bot = getBot(id);
  if (!bot || bot.ownerUserId !== user.id) {
    return res.status(404).json({ error: "Bot not found" });
  }
  const info = await fetchTelegramWebhookInfo(bot.token);
  const displayName = await resolveBotLabel(bot);
  return res.json({ bot: { ...bot, displayName }, webhookInfo: info });
});

export default router;
