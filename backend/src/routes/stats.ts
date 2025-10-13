import { Router } from "express";
import { requireAuth } from "../middleware/session";
import { db } from "../db";

const router = Router();

const countUsersStmt = db.prepare("SELECT COUNT(*) as count FROM users");
const countBotsStmt = db.prepare("SELECT COUNT(*) as count FROM bots");
const countDestinationsStmt = db.prepare("SELECT COUNT(*) as count FROM destinations");
const countSubscriptionsStmt = db.prepare("SELECT COUNT(*) as count FROM subscriptions");
const countEventsStmt = db.prepare("SELECT COUNT(*) as count FROM webhook_event_logs");

const listUsersStmt = db.prepare(`
  SELECT
    u.id,
    u.username,
    u.telegram_user_id as telegramUserId,
    u.is_admin as isAdmin,
    u.first_seen_at as firstSeenAt,
    (SELECT COUNT(*) FROM bots b WHERE b.owner_user_id = u.id) AS bots,
    (SELECT COUNT(*) FROM destinations d WHERE d.owner_user_id = u.id) AS destinations,
    (SELECT COUNT(*) FROM subscriptions s WHERE s.owner_user_id = u.id) AS subscriptions
  FROM users u
  ORDER BY u.first_seen_at ASC, u.id ASC
`);

const listSubscriptionsStmt = db.prepare(`
  SELECT
    s.id,
    s.repo,
    s.events_csv as events,
    s.created_at as createdAt,
    u.username,
    u.telegram_user_id as telegramUserId,
    d.title as destinationTitle,
    d.chat_id as destinationChatId,
    d.topic_id as topicId
  FROM subscriptions s
  INNER JOIN users u ON u.id = s.owner_user_id
  INNER JOIN destinations d ON d.id = s.destination_id
  ORDER BY s.created_at DESC
  LIMIT 50
`);

const listEventsStmt = db.prepare(`
  SELECT id, created_at as createdAt, event_type as eventType, repository, status, summary, error_message as error
  FROM webhook_event_logs
  ORDER BY created_at DESC
  LIMIT 50
`);

function maskValue(value: unknown, keep = 3): string {
  if (!value) {
    return "-";
  }
  const str = String(value);
  if (str.startsWith("@")) {
    return str;
  }
  if (str.startsWith("-100") && str.length > 7) {
    return `-100…${str.slice(-4)}`;
  }
  if (str.length <= keep) {
    return "•".repeat(str.length);
  }
  return `${str.slice(0, keep)}…`;
}

function formatDate(value: unknown): string {
  if (!value) {
    return "-";
  }
  const date = new Date(value as string);
  return Number.isNaN(date.getTime()) ? "-" : date.toISOString();
}

router.get("/", requireAuth, (_req, res) => {
  const user = (_req as any).user;
  if (!user?.isAdmin) {
    return res.status(403).json({ error: "forbidden" });
  }

  const summary = {
    users: Number((countUsersStmt.get() as { count: number }).count || 0),
    bots: Number((countBotsStmt.get() as { count: number }).count || 0),
    destinations: Number((countDestinationsStmt.get() as { count: number }).count || 0),
    subscriptions: Number((countSubscriptionsStmt.get() as { count: number }).count || 0),
    events: Number((countEventsStmt.get() as { count: number }).count || 0)
  };

  const users = listUsersStmt.all() as Array<{
    id: number;
    username: string | null;
    telegramUserId: string | null;
    isAdmin: number;
    firstSeenAt: string | null;
    bots: number;
    destinations: number;
    subscriptions: number;
  }>;

  const userRows = users.map((row) => ({
    id: row.id,
    username: row.username || "-",
    telegramMasked: maskValue(row.telegramUserId, 3),
    isAdmin: Boolean(row.isAdmin),
    bots: Number(row.bots || 0),
    destinations: Number(row.destinations || 0),
    subscriptions: Number(row.subscriptions || 0),
    firstSeenAt: formatDate(row.firstSeenAt)
  }));

  const subscriptions = listSubscriptionsStmt.all() as Array<{
    id: number;
    repo: string;
    events: string;
    createdAt: string | null;
    username: string | null;
    telegramUserId: string | null;
    destinationTitle: string | null;
    destinationChatId: string | null;
    topicId: number | null;
  }>;

  const subscriptionRows = subscriptions.map((row) => ({
    id: row.id,
    repo: row.repo,
    events: row.events || "*",
    ownerUsername: row.username || "-",
    ownerMasked: maskValue(row.telegramUserId, 3),
    destinationTitle: row.destinationTitle || "-",
    destinationMasked: maskValue(row.destinationChatId, 3),
    topicId: row.topicId,
    createdAt: formatDate(row.createdAt)
  }));

  const events = listEventsStmt.all() as Array<{
    id: number;
    createdAt: string | null;
    eventType: string | null;
    repository: string | null;
    status: string | null;
    summary: string | null;
    error: string | null;
  }>;

  const eventRows = events.map((row) => ({
    id: row.id,
    createdAt: formatDate(row.createdAt),
    eventType: row.eventType || "unknown",
    repository: row.repository || "-",
    status: row.status || "unknown",
    summary: row.summary || "",
    error: row.error || null
  }));

  return res.json({ summary, users: userRows, subscriptions: subscriptionRows, events: eventRows });
});

export default router;
