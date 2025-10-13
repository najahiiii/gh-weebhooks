import { db } from "../db";

export type EventLog = {
  id: number;
  createdAt: string;
  subscriptionId: number | null;
  hookId: string | null;
  eventType: string;
  repository: string;
  status: string;
  summary: string;
  payload: string;
  errorMessage: string | null;
};

const insertStmt = db.prepare(
  `INSERT INTO webhook_event_logs (subscription_id, hook_id, event_type, repository, status, summary, payload, error_message)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
);

const listBySubscriptionStmt = db.prepare(
  `SELECT id, created_at as createdAt, subscription_id as subscriptionId, hook_id as hookId, event_type as eventType, repository, status, summary, payload, error_message as errorMessage
   FROM webhook_event_logs WHERE subscription_id = ? ORDER BY created_at DESC LIMIT 50`
);
const deleteBySubscriptionStmt = db.prepare(
  `DELETE FROM webhook_event_logs WHERE subscription_id = ?`
);

export function createLog(log: Omit<EventLog, "id" | "createdAt">): void {
  insertStmt.run(
    log.subscriptionId ?? null,
    log.hookId ?? null,
    log.eventType,
    log.repository,
    log.status,
    log.summary,
    log.payload,
    log.errorMessage ?? null
  );
}

export function listLogsForSubscription(subscriptionId: number): EventLog[] {
  return listBySubscriptionStmt.all(subscriptionId) as EventLog[];
}

export function deleteLogsForSubscription(subscriptionId: number): void {
  deleteBySubscriptionStmt.run(subscriptionId);
}
