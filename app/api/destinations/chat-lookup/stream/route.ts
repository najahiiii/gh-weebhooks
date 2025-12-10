import { getAuthenticatedUser, unauthorized } from "@/lib/auth";
import { getBot } from "@/lib/services/bots";
import {
  addLookupListener,
  getChatLookupStatus,
  startChatLookup
} from "@/lib/services/telegramLookup";
import { NextRequest } from "next/server";
import { z } from "zod";

const streamSchema = z.object({
  botId: z.coerce.number()
});

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return unauthorized();
  }

  const url = new URL(request.url);
  const parseResult = streamSchema.safeParse(Object.fromEntries(url.searchParams.entries()));
  if (!parseResult.success) {
    return new Response("Invalid botId", { status: 400 });
  }

  const { botId } = parseResult.data;
  const bot = getBot(botId);
  if (!bot || bot.ownerUserId !== user.id) {
    return new Response("Bot not found", { status: 404 });
  }

  // Ensure lookup session exists so client immediately listens.
  const state = startChatLookup(user.id, bot.id, bot.botId);

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      let closed = false;
      const send = (event: any) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          // ignore writes after close
        }
      };

      // Prime with current status so client can hydrate immediately.
      const status = getChatLookupStatus(user.id, bot.botId);
      send({ type: "status", status });

      const dispose = addLookupListener(user.id, bot.botId, (payload) => send(payload));

      const keepAlive = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`:\n\n`));
        } catch {
          // ignore keepalive errors if closed concurrently
        }
      }, 20000);

      const closeStream = () => {
        if (closed) return;
        closed = true;
        clearInterval(keepAlive);
        dispose();
        try {
          controller.close();
        } catch {
          // already closed
        }
      };

      // If the consumer cancels the stream, ensure cleanup.
      const abort = () => closeStream();
      (controller as any).signal?.addEventListener?.("abort", abort);
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive"
    }
  });
}
