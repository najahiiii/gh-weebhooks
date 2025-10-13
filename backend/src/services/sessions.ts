import { db } from "../db";
import { addHours, nowIsoWithTimezone } from "../utils/time";
import { randomToken } from "../utils/crypto";

const insertSession = db.prepare(
  `INSERT INTO admin_sessions (user_id, token, created_at, expires_at) VALUES (?, ?, ?, ?)`
);
const deleteExpiredForUser = db.prepare(
  `DELETE FROM admin_sessions WHERE user_id = ? AND expires_at < ?`
);
const deleteByToken = db.prepare(
  `DELETE FROM admin_sessions WHERE token = ?`
);
const selectSession = db.prepare(
  `SELECT token, expires_at as expiresAt FROM admin_sessions WHERE token = ?`
);

export type SessionRecord = {
  token: string;
  expiresAt: string;
};

export function createSession(userId: number, durationHours: number): SessionRecord {
  const now = nowIsoWithTimezone();
  const expiresAt = addHours(now, durationHours);
  const token = randomToken();

  deleteExpiredForUser.run(userId, now);
  insertSession.run(userId, token, now, expiresAt);

  return { token, expiresAt };
}

export function getSession(token: string): SessionRecord | undefined {
  return selectSession.get(token) as SessionRecord | undefined;
}

export function revokeSession(token: string): void {
  deleteByToken.run(token);
}
