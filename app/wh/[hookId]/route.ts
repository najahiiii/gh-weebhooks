import { verifyGithubSignature } from "@/lib/crypto";
import { getBot } from "@/lib/services/bots";
import { getDestination } from "@/lib/services/destinations";
import { createLog } from "@/lib/services/eventLogs";
import { summarizeGithubEvent } from "@/lib/services/github";
import { getSubscriptionByHook } from "@/lib/services/subscriptions";
import { sendTelegramMessage } from "@/lib/services/telegram";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, { params }: { params: Promise<{ hookId: string }> }) {
  const { hookId } = await params;
  if (!hookId) {
    return new NextResponse("Hook not found", { status: 404 });
  }

  const subscription = getSubscriptionByHook(hookId);
  if (!subscription) {
    return new NextResponse("Hook not found", { status: 404 });
  }

  const bodyBuffer = Buffer.from(await request.arrayBuffer());
  const signature = request.headers.get("x-hub-signature-256");
  const eventType = request.headers.get("x-github-event") || "unknown";

  if (bodyBuffer.length === 0) {
    return new NextResponse("Missing body", { status: 400 });
  }

  if (!verifyGithubSignature(subscription.secret, bodyBuffer, signature)) {
    createLog({
      subscriptionId: subscription.id,
      hookId: subscription.hookId,
      eventType,
      repository: subscription.repo,
      status: "error",
      summary: "Invalid signature",
      payload: bodyBuffer.toString("utf-8"),
      errorMessage: "Signature mismatch"
    });
    return new NextResponse("Invalid signature", { status: 401 });
  }

  const eventsCsv = subscription.eventsCsv || "*";
  if (eventsCsv !== "*") {
    const allowed = eventsCsv.split(",").map((item) => item.trim()).filter(Boolean);
    if (allowed.length && !allowed.includes(eventType)) {
      createLog({
        subscriptionId: subscription.id,
        hookId: subscription.hookId,
        eventType,
        repository: subscription.repo,
        status: "ignored",
        summary: `Event ${eventType} ignored`,
        payload: bodyBuffer.toString("utf-8"),
        errorMessage: null
      });
      return new NextResponse("ignored");
    }
  }

  let payload: unknown;
  try {
    payload = JSON.parse(bodyBuffer.toString("utf-8"));
  } catch (error) {
    createLog({
      subscriptionId: subscription.id,
      hookId: subscription.hookId,
      eventType,
      repository: subscription.repo,
      status: "error",
      summary: "Invalid JSON",
      payload: bodyBuffer.toString("utf-8"),
      errorMessage: "Failed to parse payload"
    });
    return new NextResponse("Invalid JSON", { status: 400 });
  }

  const bot = getBot(subscription.botId);
  const destination = getDestination(subscription.destinationId);
  if (!bot || !destination) {
    createLog({
      subscriptionId: subscription.id,
      hookId: subscription.hookId,
      eventType,
      repository: subscription.repo,
      status: "error",
      summary: "Bot or destination missing",
      payload: JSON.stringify(payload),
      errorMessage: "Missing resources"
    });
    return new NextResponse("Missing resources", { status: 500 });
  }

  const summary = summarizeGithubEvent(eventType, payload);

  try {
    await sendTelegramMessage(bot.token, destination.chatId, summary, destination.topicId ?? undefined);
    createLog({
      subscriptionId: subscription.id,
      hookId: subscription.hookId,
      eventType,
      repository: subscription.repo,
      status: "success",
      summary,
      payload: JSON.stringify(payload),
      errorMessage: null
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to forward";
    createLog({
      subscriptionId: subscription.id,
      hookId: subscription.hookId,
      eventType,
      repository: subscription.repo,
      status: "error",
      summary,
      payload: JSON.stringify(payload),
      errorMessage: message
    });
    return new NextResponse("Failed to forward", { status: 500 });
  }

  return new NextResponse(`Event ${eventType} forwarded`);
}
