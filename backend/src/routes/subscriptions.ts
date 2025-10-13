import { Router } from "express";
import { z } from "zod";
import { config } from "../config";
import { requireAuth } from "../middleware/session";
import {
  createSubscription,
  deleteSubscription,
  getSubscriptionById,
  listSubscriptions,
  setSubscriptionGithubSyncError,
  setSubscriptionGithubSyncSkipped,
  setSubscriptionGithubSyncSuccess,
  updateSubscription
} from "../services/subscriptions";
import { getBot } from "../services/bots";
import { getDestination } from "../services/destinations";
import { randomToken } from "../utils/crypto";
import { createLog, listLogsForSubscription } from "../services/eventLogs";
import { getGithubAccount } from "../services/githubAccounts";
import {
  createRepoWebhook,
  deleteRepoWebhook,
  GithubApiError,
  listRepoWebhooks,
  parseRepoFullName,
  updateRepoWebhook
} from "../services/githubApi";

const router = Router();

function normalizeEvents(csv: string): string[] {
  if (!csv) {
    return ["*"];
  }
  const raw = csv.split(",").map((entry) => entry.trim()).filter(Boolean);
  if (raw.length === 0 || raw.includes("*")) {
    return ["*"];
  }
  return Array.from(new Set(raw));
}

function formatGithubError(error: unknown): string {
  if (error instanceof GithubApiError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "Unknown GitHub error";
}

async function ensureGithubWebhook(
  token: string,
  repoFullName: string,
  webhookUrl: string,
  secret: string,
  events: string[]
) {
  const { owner, name } = parseRepoFullName(repoFullName);
  try {
    return await createRepoWebhook(token, owner, name, { url: webhookUrl, secret, events });
  } catch (err) {
    if (err instanceof GithubApiError && err.status === 422) {
      const hooks = await listRepoWebhooks(token, owner, name);
      const existing = hooks.find((hook) => hook.config?.url === webhookUrl);
      if (existing) {
        return await updateRepoWebhook(token, owner, name, existing.id, { url: webhookUrl, secret, events });
      }
    }
    throw err;
  }
}

async function deleteGithubWebhook(token: string, repoFullName: string, hookId: string) {
  const { owner, name } = parseRepoFullName(repoFullName);
  await deleteRepoWebhook(token, owner, name, Number(hookId));
}

router.get("/", requireAuth, (req, res) => {
  const user = (req as any).user;
  const subscriptions = listSubscriptions(user.id);
  return res.json({ subscriptions });
});

const createSchema = z.object({
  repo: z.string().regex(/^[^\s\/]+\/[^\s\/]+$/),
  events: z.string().default("*"),
  botId: z.number(),
  destinationId: z.number()
});

router.post("/", requireAuth, async (req, res) => {
  const user = (req as any).user;
  const parseResult = createSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: "Invalid payload" });
  }
  const { repo, events, botId, destinationId } = parseResult.data;
  const bot = getBot(botId);
  if (!bot || bot.ownerUserId !== user.id) {
    return res.status(400).json({ error: "Bot not found" });
  }
  const destination = getDestination(destinationId);
  if (!destination || destination.ownerUserId !== user.id) {
    return res.status(400).json({ error: "Destination not found" });
  }
  const hookId = randomToken(18);
  const secret = randomToken(32);
  const eventsCsv = events || "*";
  const subscription = createSubscription(user.id, hookId, secret, repo, eventsCsv, botId, destinationId);
  createLog({
    subscriptionId: subscription.id,
    hookId,
    eventType: "create",
    repository: repo,
    status: "info",
    summary: `Subscription created for ${repo}`,
    payload: "{}",
    errorMessage: null
  });

  let githubIntegration: { status: string; message?: string; hookId?: string; hookUrl?: string } | null = null;
  if (config.githubAutoWebhook) {
    const account = getGithubAccount(user.id);
    if (!account) {
      setSubscriptionGithubSyncSkipped(subscription.id, "GitHub account not connected");
      githubIntegration = { status: "skipped", message: "Connect GitHub to sync repository webhooks automatically." };
    } else {
      try {
        const eventsList = normalizeEvents(eventsCsv);
        const webhookUrl = `${config.publicBaseUrl}/wh/${hookId}`;
        const hook = await ensureGithubWebhook(account.accessToken, repo, webhookUrl, secret, eventsList);
        setSubscriptionGithubSyncSuccess(subscription.id, { hookId: String(hook.id), hookUrl: hook.url });
        githubIntegration = { status: "success", hookId: String(hook.id), hookUrl: hook.url };
      } catch (err) {
        const message = formatGithubError(err);
        setSubscriptionGithubSyncError(subscription.id, message);
        githubIntegration = { status: "error", message };
      }
    }
  } else {
    setSubscriptionGithubSyncSkipped(subscription.id, "GitHub auto webhook disabled");
    githubIntegration = { status: "skipped", message: "Automatic GitHub webhook sync disabled by configuration." };
  }

  const finalSubscription = getSubscriptionById(subscription.id) ?? subscription;
  return res.status(201).json({
    subscription: finalSubscription,
    webhook: {
      payloadUrl: `${req.protocol}://${req.get("host")}/wh/${hookId}`,
      secret,
      events: eventsCsv,
      contentType: "application/json"
    },
    githubIntegration
  });
});

const updateSchema = z.object({
  repo: z.string().regex(/^[^\s\/]+\/[^\s\/]+$/),
  events: z.string().default("*"),
  botId: z.number(),
  destinationId: z.number()
});

router.put("/:id", requireAuth, async (req, res) => {
  const user = (req as any).user;
  const id = Number.parseInt(req.params.id, 10);
  if (Number.isNaN(id)) {
    return res.status(404).json({ error: "Subscription not found" });
  }
  const existing = getSubscriptionById(id);
  if (!existing || existing.ownerUserId !== user.id) {
    return res.status(404).json({ error: "Subscription not found" });
  }
  const parseResult = updateSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: "Invalid payload" });
  }
  const { repo, events, botId, destinationId } = parseResult.data;
  const bot = getBot(botId);
  if (!bot || bot.ownerUserId !== user.id) {
    return res.status(400).json({ error: "Bot not found" });
  }
  const destination = getDestination(destinationId);
  if (!destination || destination.ownerUserId !== user.id) {
    return res.status(400).json({ error: "Destination not found" });
  }

  const eventsCsv = events || "*";
  updateSubscription(id, repo, eventsCsv, botId, destinationId);

  let githubIntegration: { status: string; message?: string; hookId?: string; hookUrl?: string } | null = null;
  if (config.githubAutoWebhook) {
    const account = getGithubAccount(user.id);
    if (!account) {
      setSubscriptionGithubSyncSkipped(id, "GitHub account not connected");
      githubIntegration = { status: "skipped", message: "Connect GitHub to sync repository webhooks automatically." };
    } else {
      const eventsList = normalizeEvents(eventsCsv);
      const webhookUrl = `${config.publicBaseUrl}/wh/${existing.hookId}`;
      try {
        if (existing.githubHookId && existing.repo !== repo) {
          try {
            await deleteGithubWebhook(account.accessToken, existing.repo, existing.githubHookId);
          } catch (err) {
            console.warn("Failed to delete previous GitHub webhook", err);
          }
        }
        const target = getSubscriptionById(id);
        if (!target) {
          throw new Error("Subscription not found after update");
        }
        const { owner, name } = parseRepoFullName(repo);
        let hook;
        if (target.githubHookId && existing.repo === repo) {
          hook = await updateRepoWebhook(account.accessToken, owner, name, Number(target.githubHookId), {
            url: webhookUrl,
            secret: target.secret,
            events: eventsList
          });
        } else {
          hook = await ensureGithubWebhook(account.accessToken, repo, webhookUrl, target.secret, eventsList);
        }
        setSubscriptionGithubSyncSuccess(id, { hookId: String(hook.id), hookUrl: hook.url });
        githubIntegration = { status: "success", hookId: String(hook.id), hookUrl: hook.url };
      } catch (err) {
        const message = formatGithubError(err);
        setSubscriptionGithubSyncError(id, message);
        githubIntegration = { status: "error", message };
      }
    }
  } else {
    setSubscriptionGithubSyncSkipped(id, "GitHub auto webhook disabled");
    githubIntegration = { status: "skipped", message: "Automatic GitHub webhook sync disabled by configuration." };
  }

  const updated = getSubscriptionById(id) ?? {
    ...existing,
    repo,
    eventsCsv,
    botId,
    destinationId
  };
  return res.json({ subscription: updated, githubIntegration });
});

router.delete("/:id", requireAuth, async (req, res) => {
  const user = (req as any).user;
  const id = Number.parseInt(req.params.id, 10);
  if (Number.isNaN(id)) {
    return res.status(404).json({ error: "Subscription not found" });
  }
  const subscription = getSubscriptionById(id);
  if (!subscription || subscription.ownerUserId !== user.id) {
    return res.status(404).json({ error: "Subscription not found" });
  }

  let githubIntegration: { status: string; message?: string } | null = null;
  if (config.githubAutoWebhook && subscription.githubHookId) {
    const account = getGithubAccount(user.id);
    if (account) {
      try {
        await deleteGithubWebhook(account.accessToken, subscription.repo, subscription.githubHookId);
        githubIntegration = { status: "success" };
      } catch (err) {
        const message = formatGithubError(err);
        githubIntegration = { status: "error", message };
      }
    } else {
      githubIntegration = { status: "skipped", message: "GitHub account not connected." };
    }
  }

  deleteSubscription(id);
  return res.json({ ok: true, githubIntegration });
});

router.get("/:id/logs", requireAuth, (req, res) => {
  const user = (req as any).user;
  const id = Number.parseInt(req.params.id, 10);
  if (Number.isNaN(id)) {
    return res.status(404).json({ error: "Subscription not found" });
  }
  const subs = listSubscriptions(user.id);
  if (!subs.find((sub) => sub.id === id)) {
    return res.status(404).json({ error: "Subscription not found" });
  }
  const logs = listLogsForSubscription(id);
  return res.json({ logs });
});

export default router;
