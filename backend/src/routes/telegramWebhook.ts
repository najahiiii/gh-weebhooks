import { Router } from "express";
import { getBotByTelegramId } from "../services/bots";
import { getUserByTelegramId } from "../services/users";
import { hasPendingLookup, setChatLookupResult } from "../services/telegramLookup";

const router = Router();

router.post("/:botId/:token", (req, res) => {
  const botTelegramId = req.params.botId;
  const update = req.body;

  try {
    if (update?.message) {
      console.debug("[chat-lookup] incoming message", {
        botTelegramId,
        hasForward: Boolean(update.message.forward_from_chat || update.message.forward_origin),
        messageThreadId: update.message.message_thread_id,
        isTopicMessage: update.message.is_topic_message,
        viaBot: update.message.via_bot?.username ?? null
      });
      if (update.message.forward_from_chat || update.message.forward_origin) {
        console.debug("[chat-lookup] forward payload", {
          botTelegramId,
          forwardFromChat: update.message.forward_from_chat,
          forwardOrigin: update.message.forward_origin
        });
      }
    }
    if (update && typeof update === "object" && update.message) {
      handleMessageUpdate(botTelegramId, update.message);
    }
  } catch (err) {
    console.error("[telegram-webhook] failed to process update", err);
  }

  return res.send("ok");
});

function handleMessageUpdate(botTelegramId: string, message: any) {
  const from = message?.from;
  if (!from || typeof from.id === "undefined") {
    console.debug("[chat-lookup] skip update (missing from)", { botTelegramId });
    return;
  }
  const telegramUserId = String(from.id);
  const user = getUserByTelegramId(telegramUserId);
  if (!user) {
    console.debug("[chat-lookup] skip update (user not registered)", { botTelegramId, telegramUserId });
    return;
  }

  if (!hasPendingLookup(user.id, botTelegramId)) {
    // If there's no matching lookup, ignore silently (common case).
    return;
  }

  const bot = getBotByTelegramId(botTelegramId);
  if (!bot) {
    console.warn("[chat-lookup] bot not found for webhook update", { botTelegramId });
    return;
  }

  const forwardChat = message.forward_from_chat;
  const forwardOrigin = message.forward_origin;
  const originChat = message.chat;

  let sourceChat: any = null;
  let via: "forward" | "message" | null = null;

  if (forwardChat && typeof forwardChat === "object") {
    sourceChat = forwardChat;
    via = "forward";
  } else if (forwardOrigin && typeof forwardOrigin === "object" && forwardOrigin.chat && typeof forwardOrigin.chat === "object") {
    sourceChat = forwardOrigin.chat;
    via = "forward";
  } else if (originChat && typeof originChat === "object") {
    sourceChat = originChat;
    via = "message";
  }

  if (!sourceChat || !via) {
    console.debug("[chat-lookup] unable to resolve source chat", { botTelegramId, via });
    return;
  }

  if (typeof sourceChat.id === "undefined") {
    console.debug("[chat-lookup] chat missing id field", { botTelegramId, via });
    return;
  }

  let topicId: number | null = null;
  const forwardedTopicId =
    (forwardOrigin && typeof forwardOrigin === "object" && typeof (forwardOrigin as any).message_thread_id === "number"
      ? ((forwardOrigin as any).message_thread_id as number)
      : null);
  const candidates: Array<unknown> = [
    message.message_thread_id,
    message.is_topic_message ? message.message_thread_id : undefined,
    message.reply_to_message?.message_thread_id,
    message.reply_to_message?.forum_topic_created?.topic_id,
    message.reply_to_message?.forum_topic_closed?.topic_id,
    message.reply_to_message?.forum_topic_reopened?.topic_id,
    message.reply_to_message?.is_topic_message ? message.reply_to_message.message_thread_id : undefined,
    forwardedTopicId,
    message.reply_to_message?.forward_origin?.message_thread_id,
    message.reply_to_message?.forward_from_chat?.message_thread_id
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "number") {
      topicId = candidate;
      break;
    }
  }

  if (!topicId && sourceChat?.is_forum === true && typeof message.message_thread_id === "number") {
    topicId = message.message_thread_id;
  }

  console.debug("[chat-lookup] detected chat", {
    botTelegramId,
    userId: user.id,
    chatId: sourceChat.id,
    chatType: sourceChat.type,
    via,
    topicId
  });

  setChatLookupResult(user.id, botTelegramId, {
    chatId: String(sourceChat.id),
    chatType: sourceChat.type ?? null,
    title: sourceChat.title ?? null,
    username: sourceChat.username ?? null,
    topicId,
    via,
    detectedAt: Date.now()
  });
}

export default router;
