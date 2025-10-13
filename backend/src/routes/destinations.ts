import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/session";
import {
  createDestination,
  deleteDestination,
  getDestination,
  listDestinations,
  updateDestination,
  setDefaultDestination
} from "../services/destinations";
import { parseTopicId } from "../utils/telegram";
import { countSubscriptionsForDestination } from "../services/subscriptions";
import { getBot } from "../services/bots";
import {
  clearChatLookup,
  getChatLookupStatus,
  startChatLookup
} from "../services/telegramLookup";

const router = Router();

router.get("/", requireAuth, (req, res) => {
  const user = (req as any).user;
  const destinations = listDestinations(user.id);
  return res.json({ destinations });
});

const chatLookupStartSchema = z.object({ botId: z.number() });

router.post("/chat-lookup/start", requireAuth, (req, res) => {
  const user = (req as any).user;
  const parseResult = chatLookupStartSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: "Invalid payload" });
  }
  const { botId } = parseResult.data;
  const bot = getBot(botId);
  if (!bot || bot.ownerUserId !== user.id) {
    return res.status(404).json({ error: "Bot not found" });
  }
  const state = startChatLookup(user.id, bot.id, bot.botId);

  return res.json({
    status: "pending",
    expiresAt: new Date(state.expiresAt).toISOString()
  });
});

router.get("/chat-lookup/status", requireAuth, (req, res) => {
  const user = (req as any).user;
  const botIdRaw = req.query.botId;
  const botId = Number.parseInt(String(botIdRaw || ""), 10);
  if (Number.isNaN(botId)) {
    return res.status(400).json({ error: "Invalid bot id" });
  }
  const bot = getBot(botId);
  if (!bot || bot.ownerUserId !== user.id) {
    return res.status(404).json({ error: "Bot not found" });
  }
  const status = getChatLookupStatus(user.id, bot.botId);
  return res.json(status);
});

router.post("/chat-lookup/reset", requireAuth, (req, res) => {
  const user = (req as any).user;
  const botIdRaw = req.body?.botId ?? req.query.botId;
  const botId = Number.parseInt(String(botIdRaw || ""), 10);
  if (Number.isNaN(botId)) {
    return res.status(400).json({ error: "Invalid bot id" });
  }
  const bot = getBot(botId);
  if (!bot || bot.ownerUserId !== user.id) {
    return res.status(404).json({ error: "Bot not found" });
  }
  clearChatLookup(user.id, bot.botId);
  return res.json({ ok: true });
});

const createSchema = z.object({
  chatId: z.string().min(3),
  title: z.string().optional(),
  isDefault: z.boolean().optional(),
  topicId: z.union([z.number(), z.string()]).optional()
});

router.post("/", requireAuth, (req, res) => {
  const user = (req as any).user;
  const parseResult = createSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: "Invalid payload" });
  }
  const { chatId, title, isDefault, topicId } = parseResult.data;
  const parsedTopic = topicId === undefined ? null : parseTopicId(topicId);
  const destination = createDestination(
    user.id,
    chatId,
    title ?? "",
    Boolean(isDefault),
    parsedTopic
  );
  return res.status(201).json({ destination });
});

const updateSchema = z.object({
  chatId: z.string().optional(),
  title: z.string().optional(),
  isDefault: z.boolean().optional(),
  topicId: z.union([z.number(), z.string(), z.null()]).optional()
});

router.put("/:id", requireAuth, (req, res) => {
  const user = (req as any).user;
  const id = Number.parseInt(req.params.id, 10);
  if (Number.isNaN(id)) {
    return res.status(404).json({ error: "Destination not found" });
  }
  const destination = getDestination(id);
  if (!destination || destination.ownerUserId !== user.id) {
    return res.status(404).json({ error: "Destination not found" });
  }
  const parseResult = updateSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: "Invalid payload" });
  }
  const { chatId, title, isDefault, topicId } = parseResult.data;
  const parsedTopic = topicId === undefined ? destination.topicId : parseTopicId(topicId);
  updateDestination(
    user.id,
    id,
    chatId ?? destination.chatId,
    title ?? destination.title,
    isDefault ?? destination.isDefault,
    parsedTopic
  );
  return res.json({ ok: true });
});

router.delete("/:id", requireAuth, (req, res) => {
  const user = (req as any).user;
  const id = Number.parseInt(req.params.id, 10);
  if (Number.isNaN(id)) {
    return res.status(404).json({ error: "Destination not found" });
  }
  const destination = getDestination(id);
  if (!destination || destination.ownerUserId !== user.id) {
    return res.status(404).json({ error: "Destination not found" });
  }
  const activeSubs = countSubscriptionsForDestination(destination.id);
  if (activeSubs > 0) {
    return res.status(409).json({
      error: "destination_has_subscriptions",
      message: "Remove subscriptions linked to this destination before deleting it."
    });
  }
  deleteDestination(id);
  return res.json({ ok: true });
});

router.post("/:id/default", requireAuth, (req, res) => {
  const user = (req as any).user;
  const id = Number.parseInt(req.params.id, 10);
  if (Number.isNaN(id)) {
    return res.status(404).json({ error: "Destination not found" });
  }
  const destination = getDestination(id);
  if (!destination || destination.ownerUserId !== user.id) {
    return res.status(404).json({ error: "Destination not found" });
  }
  setDefaultDestination(user.id, id);
  return res.json({ ok: true });
});

export default router;
