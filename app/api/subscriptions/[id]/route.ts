import { getAuthenticatedUser, unauthorized } from "@/lib/auth";
import { config } from "@/lib/config";
import { getBot } from "@/lib/services/bots";
import { getDestination } from "@/lib/services/destinations";
import { createLog } from "@/lib/services/eventLogs";
import { getGithubAccount } from "@/lib/services/githubAccounts";
import {
  createRepoWebhook,
  deleteRepoWebhook,
  GithubApiError,
  listRepoWebhooks,
  parseRepoFullName,
  updateRepoWebhook
} from "@/lib/services/githubApi";
import {
  deleteSubscription,
  getSubscriptionById,
  setSubscriptionGithubSyncError,
  setSubscriptionGithubSyncSkipped,
  setSubscriptionGithubSyncSuccess,
  updateSubscription
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

async function deleteGithubWebhook(token: string, repoFullName: string, hookId: string) {
  const { owner, name } = parseRepoFullName(repoFullName);
  await deleteRepoWebhook(token, owner, name, Number(hookId));
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const updateSchema = z.object({
  repo: z.string().regex(/^[^\s/]+\/[^\s/]+$/),
  events: z.string().default("*"),
  botId: z.number(),
  destinationId: z.number()
});

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return unauthorized();
  }
  const { id: rawId } = await params;
  const id = Number.parseInt(rawId, 10);
  if (Number.isNaN(id)) {
    return NextResponse.json({ error: "Subscription not found" }, { status: 404 });
  }
  const existing = getSubscriptionById(id);
  if (!existing || existing.ownerUserId !== user.id) {
    return NextResponse.json({ error: "Subscription not found" }, { status: 404 });
  }
  const parseResult = updateSchema.safeParse(await request.json());
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
      const webhookUrl = `${config.publicBaseUrl.replace(/\/$/, "")}/wh/${existing.hookId}`;
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

  const subscription = getSubscriptionById(id) ?? existing;
  return NextResponse.json({ ok: true, subscription, githubIntegration });
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return unauthorized();
  }
  const { id: rawId } = await params;
  const id = Number.parseInt(rawId, 10);
  if (Number.isNaN(id)) {
    return NextResponse.json({ error: "Subscription not found" }, { status: 404 });
  }
  const existing = getSubscriptionById(id);
  if (!existing || existing.ownerUserId !== user.id) {
    return NextResponse.json({ error: "Subscription not found" }, { status: 404 });
  }
  deleteSubscription(id);
  createLog({
    subscriptionId: null,
    hookId: existing.hookId,
    eventType: "delete",
    repository: existing.repo,
    status: "info",
    summary: `Subscription ${existing.repo} deleted`,
    payload: "{}",
    errorMessage: null
  });
  return NextResponse.json({ ok: true });
}
