import { Router } from "express";
import { getSubscriptionByHook } from "../services/subscriptions";
import { verifyGithubSignature } from "../utils/crypto";
import { summarizeGithubEvent } from "../services/github";
import { sendTelegramMessage } from "../services/telegram";
import { getBot } from "../services/bots";
import { getDestination } from "../services/destinations";
import { createLog } from "../services/eventLogs";

const router = Router();

router.post("/:hookId", async (req, res) => {
  const bodyBuffer: Buffer = (req as any).rawBody;
  const signature = req.header("x-hub-signature-256");
  const eventType = req.header("x-github-event") || "unknown";

  if (!bodyBuffer) {
    return res.status(400).send("Missing body");
  }

  const subscription = getSubscriptionByHook(req.params.hookId);
  if (!subscription) {
    return res.status(404).send("Hook not found");
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
    return res.status(401).send("Invalid signature");
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
      return res.send("ignored");
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
    return res.status(400).send("Invalid JSON");
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
    return res.status(500).send("Missing resources");
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
    return res.status(500).send("Failed to forward");
  }

  return res.send(`Event ${eventType} forwarded`);
});

export default router;
