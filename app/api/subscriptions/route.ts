import { getAuthenticatedUser, unauthorized } from "@/lib/auth";
import { config } from "@/lib/config";
import { randomToken } from "@/lib/crypto";
import { getBot } from "@/lib/services/bots";
import { getDestination } from "@/lib/services/destinations";
import { createLog } from "@/lib/services/eventLogs";
import { getGithubAccount } from "@/lib/services/githubAccounts";
import {
  createRepoWebhook,
  GithubApiError,
  listRepoWebhooks,
  parseRepoFullName,
  updateRepoWebhook
} from "@/lib/services/githubApi";
import {
  createSubscription,
  getSubscriptionById,
  listSubscriptions,
  setSubscriptionGithubSyncError,
  setSubscriptionGithubSyncSkipped,
  setSubscriptionGithubSyncSuccess
} from "@/lib/services/subscriptions";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

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

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getAuthenticatedUser();
  if (!user) {
    return unauthorized();
  }
  const subscriptions = listSubscriptions(user.id);
  return NextResponse.json({ subscriptions });
}

const createSchema = z.object({
  repo: z.string().regex(/^[^\s/]+\/[^\s/]+$/),
  events: z.string().default("*"),
  botId: z.number(),
  destinationId: z.number()
});

export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return unauthorized();
  }
  const parseResult = createSchema.safeParse(await request.json());
  if (!parseResult.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }
  const { repo, events, botId, destinationId } = parseResult.data;
  const bot = getBot(botId);
  if (!bot || bot.ownerUserId !== user.id) {
    return NextResponse.json({ error: "Bot not found" }, { status: 400 });
  }
  const destination = getDestination(destinationId);
  if (!destination || destination.ownerUserId !== user.id) {
    return NextResponse.json({ error: "Destination not found" }, { status: 400 });
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
        const webhookUrl = `${config.publicBaseUrl.replace(/\/$/, "")}/wh/${hookId}`;
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
  const payloadUrl = `${config.publicBaseUrl.replace(/\/$/, "")}/wh/${hookId}`;
  return NextResponse.json(
    {
      subscription: finalSubscription,
      webhook: {
        payloadUrl,
        secret,
        events: eventsCsv,
        contentType: "application/json"
      },
      githubIntegration
    },
    { status: 201 }
  );
}
