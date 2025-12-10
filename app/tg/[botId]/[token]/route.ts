import { getBotByTelegramId } from "@/lib/services/bots";
import {
  getPendingLookupForBot,
  hasPendingLookup,
  setChatLookupResult
} from "@/lib/services/telegramLookup";
import { getUserByTelegramId } from "@/lib/services/users";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, { params }: { params: Promise<{ botId: string; token: string }> }) {
  const { botId: botTelegramId } = await params;
  if (!botTelegramId) {
    return new NextResponse("botId required", { status: 400 });
  }

  let update: any = null;
  try {
    update = await request.json();
  } catch (err) {
    console.error("[telegram-webhook] failed to parse update", err);
    return new NextResponse("ok");
  }

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
    if (update && typeof update === "object") {
      if (update.message) {
        handleMessageUpdate(botTelegramId, update.message);
      } else if (update.channel_post) {
        console.debug("[chat-lookup] incoming channel_post", {
          botTelegramId,
          messageThreadId: update.channel_post.message_thread_id,
          isTopicMessage: update.channel_post.is_topic_message
        });
        handleMessageUpdate(botTelegramId, update.channel_post);
      } else if (update.edited_channel_post) {
        console.debug("[chat-lookup] incoming edited_channel_post", {
          botTelegramId,
          messageThreadId: update.edited_channel_post.message_thread_id,
          isTopicMessage: update.edited_channel_post.is_topic_message
        });
        handleMessageUpdate(botTelegramId, update.edited_channel_post);
      }
    }
  } catch (err) {
    console.error("[telegram-webhook] failed to process update", err);
  }

  return new NextResponse("ok");
}

function handleMessageUpdate(botTelegramId: string, message: any) {
  const bot = getBotByTelegramId(botTelegramId);
  if (!bot) {
    console.warn("[chat-lookup] bot not found for webhook update", { botTelegramId });
    return;
  }

  const from = message?.from;
  let userId: number | null = null;

  if (from && typeof from.id !== "undefined") {
    const telegramUserId = String(from.id);
    const user = getUserByTelegramId(telegramUserId);
    if (!user) {
      console.debug("[chat-lookup] skip update (user not registered)", { botTelegramId, telegramUserId });
      return;
    }
    if (!hasPendingLookup(user.id, botTelegramId)) {
      return;
    }
    userId = user.id;
  } else {
    const pending = getPendingLookupForBot(botTelegramId);
    if (!pending) {
      console.debug("[chat-lookup] skip update (no pending lookup)", { botTelegramId });
      return;
    }
    userId = pending.userId ?? bot.ownerUserId;
  }

  if (userId === null) {
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
  } else if (message.sender_chat && typeof message.sender_chat === "object") {
    // Channel posts can arrive without `from`, but include sender_chat.
    sourceChat = message.sender_chat;
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
    userId,
    chatId: sourceChat.id,
    chatType: sourceChat.type,
    via,
    topicId
  });

  setChatLookupResult(userId, botTelegramId, {
    chatId: String(sourceChat.id),
    chatType: sourceChat.type ?? null,
    title: sourceChat.title ?? null,
    username: sourceChat.username ?? null,
    topicId,
    via,
    detectedAt: Date.now()
  });
}
