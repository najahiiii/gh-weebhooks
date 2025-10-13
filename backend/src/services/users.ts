import { db } from "../db";
import { nowIsoWithTimezone } from "../utils/time";

export type User = {
  id: number;
  telegramUserId: string;
  username: string | null;
  firstSeenAt: string;
  isAdmin: boolean;
};

const selectUser = db.prepare(
  `SELECT id, telegram_user_id as telegramUserId, username, first_seen_at as firstSeenAt, is_admin as isAdmin FROM users WHERE id = ?`
);
const selectUserByTelegram = db.prepare(
  `SELECT id, telegram_user_id as telegramUserId, username, first_seen_at as firstSeenAt, is_admin as isAdmin FROM users WHERE telegram_user_id = ?`
);
const insertUser = db.prepare(
  `INSERT INTO users (telegram_user_id, username, first_seen_at, is_admin) VALUES (?, ?, ?, ?)`
);
const updateUsername = db.prepare(
  `UPDATE users SET username = ? WHERE id = ?`
);
const updateAdminFlag = db.prepare(
  `UPDATE users SET is_admin = ? WHERE id = ?`
);

export function ensureUserByTelegramId(telegramUserId: string, username?: string | null, promoteToAdmin = false): User {
  const existing = selectUserByTelegram.get(telegramUserId) as (Omit<User, "isAdmin"> & { isAdmin: number }) | undefined;
  if (existing) {
    if (username && existing.username !== username) {
      updateUsername.run(username, existing.id);
    }
    if (promoteToAdmin && !existing.isAdmin) {
      updateAdminFlag.run(1, existing.id);
    }
    return {
      ...existing,
      username: username ?? existing.username,
      isAdmin: promoteToAdmin ? true : Boolean(existing.isAdmin)
    };
  }

  const firstSeen = nowIsoWithTimezone();
  const isAdmin = promoteToAdmin ? 1 : 0;
  const result = insertUser.run(telegramUserId, username ?? null, firstSeen, isAdmin);
  const id = Number(result.lastInsertRowid);
  return {
    id,
    telegramUserId,
    username: username ?? null,
    firstSeenAt: firstSeen,
    isAdmin: Boolean(isAdmin)
  };
}

export function getUserBySessionToken(token: string): User | undefined {
  const stmt = db.prepare(
    `SELECT u.id, u.telegram_user_id as telegramUserId, u.username, u.first_seen_at as firstSeenAt, u.is_admin as isAdmin
     FROM users u
     INNER JOIN admin_sessions s ON s.user_id = u.id
     WHERE s.token = ?`
  );
  const row = stmt.get(token) as ({ isAdmin: number } & Omit<User, "isAdmin">) | undefined;
  if (!row) {
    return undefined;
  }
  return { ...row, isAdmin: Boolean(row.isAdmin) };
}

export function getUserById(id: number): User | undefined {
  const row = selectUser.get(id) as (Omit<User, "isAdmin"> & { isAdmin: number }) | undefined;
  if (!row) {
    return undefined;
  }
  return { ...row, isAdmin: Boolean(row.isAdmin) };
}

export function getUserByTelegramId(telegramUserId: string): User | undefined {
  const row = selectUserByTelegram.get(telegramUserId) as (Omit<User, "isAdmin"> & { isAdmin: number }) | undefined;
  if (!row) {
    return undefined;
  }
  return { ...row, isAdmin: Boolean(row.isAdmin) };
}

export function listUsers(): User[] {
  const stmt = db.prepare(
    `SELECT id, telegram_user_id as telegramUserId, username, first_seen_at as firstSeenAt, is_admin as isAdmin FROM users`
  );
  const rows = stmt.all() as Array<Omit<User, "isAdmin"> & { isAdmin: number }>;
  return rows.map((row) => ({ ...row, isAdmin: Boolean(row.isAdmin) }));
}
