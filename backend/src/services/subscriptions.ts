import { db } from "../db";
import { deleteLogsForSubscription } from "./eventLogs";

export type Subscription = {
  id: number;
  ownerUserId: number;
  hookId: string;
  secret: string;
  repo: string;
  eventsCsv: string;
  botId: number;
  destinationId: number;
  createdAt: string;
  githubHookId: string | null;
  githubHookUrl: string | null;
  githubSyncStatus: string;
  githubSyncError: string | null;
  githubSyncedAt: string | null;
};

const baseSelect = `
  SELECT id,
         owner_user_id      AS ownerUserId,
         hook_id            AS hookId,
         secret,
         repo,
         events_csv         AS eventsCsv,
         bot_id             AS botId,
         destination_id     AS destinationId,
         created_at         AS createdAt,
         github_hook_id     AS githubHookId,
         github_hook_url    AS githubHookUrl,
         github_sync_status AS githubSyncStatus,
         github_sync_error  AS githubSyncError,
         github_synced_at   AS githubSyncedAt
    FROM subscriptions
`;

const listStmt = db.prepare(`${baseSelect} WHERE owner_user_id = ? ORDER BY created_at DESC`);
const getByHookStmt = db.prepare(`${baseSelect} WHERE hook_id = ?`);
const getByIdStmt = db.prepare(`${baseSelect} WHERE id = ?`);

const insertStmt = db.prepare(
  `INSERT INTO subscriptions (owner_user_id, hook_id, secret, repo, events_csv, bot_id, destination_id)
   VALUES (?, ?, ?, ?, ?, ?, ?)`
);
const updateStmt = db.prepare(
  `UPDATE subscriptions SET repo = ?, events_csv = ?, bot_id = ?, destination_id = ? WHERE id = ?`
);
const deleteStmt = db.prepare(`DELETE FROM subscriptions WHERE id = ?`);
const countByBotStmt = db.prepare(`SELECT COUNT(*) as count FROM subscriptions WHERE bot_id = ?`);
const countByDestinationStmt = db.prepare(`SELECT COUNT(*) as count FROM subscriptions WHERE destination_id = ?`);
const updateGithubSyncStmt = db.prepare(
  `UPDATE subscriptions
      SET github_hook_id = ?,
          github_hook_url = ?,
          github_sync_status = ?,
          github_sync_error = ?,
          github_synced_at = CURRENT_TIMESTAMP
    WHERE id = ?`
);
const updateGithubStatusStmt = db.prepare(
  `UPDATE subscriptions
      SET github_sync_status = ?,
          github_sync_error = ?,
          github_synced_at = CURRENT_TIMESTAMP
    WHERE id = ?`
);

export function listSubscriptions(ownerUserId: number): Subscription[] {
  return listStmt.all(ownerUserId) as Subscription[];
}

export function getSubscriptionById(id: number): Subscription | undefined {
  return getByIdStmt.get(id) as Subscription | undefined;
}

export function getSubscriptionByHook(hookId: string): Subscription | undefined {
  return getByHookStmt.get(hookId) as Subscription | undefined;
}

export function createSubscription(
  ownerUserId: number,
  hookId: string,
  secret: string,
  repo: string,
  eventsCsv: string,
  botId: number,
  destinationId: number
): Subscription {
  const result = insertStmt.run(ownerUserId, hookId, secret, repo, eventsCsv, botId, destinationId);
  const id = Number(result.lastInsertRowid);
  const created = getSubscriptionById(id);
  if (!created) {
    throw new Error("Failed to create subscription");
  }
  return created;
}

export function updateSubscription(
  id: number,
  repo: string,
  eventsCsv: string,
  botId: number,
  destinationId: number
): void {
  updateStmt.run(repo, eventsCsv, botId, destinationId, id);
}

export function deleteSubscription(id: number): void {
  deleteLogsForSubscription(id);
  deleteStmt.run(id);
}

export function countSubscriptionsForBot(botId: number): number {
  const row = countByBotStmt.get(botId) as { count: number } | undefined;
  return row ? Number(row.count) : 0;
}

export function countSubscriptionsForDestination(destinationId: number): number {
  const row = countByDestinationStmt.get(destinationId) as { count: number } | undefined;
  return row ? Number(row.count) : 0;
}

export function setSubscriptionGithubSyncSuccess(
  id: number,
  payload: { hookId: string; hookUrl: string }
): void {
  updateGithubSyncStmt.run(payload.hookId, payload.hookUrl, "success", "", id);
}

export function setSubscriptionGithubSyncSkipped(id: number, reason: string): void {
  updateGithubStatusStmt.run("skipped", reason, id);
}

export function setSubscriptionGithubSyncError(id: number, error: string): void {
  updateGithubStatusStmt.run("error", error, id);
}
