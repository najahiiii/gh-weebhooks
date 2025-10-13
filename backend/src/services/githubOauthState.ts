import { db } from "../db";

type OauthStateRecord = {
  id: number;
  userId: number;
  state: string;
  createdAt: string;
};

const insertStmt = db.prepare(
  `INSERT INTO github_oauth_states (user_id, state, created_at)
   VALUES (?, ?, CURRENT_TIMESTAMP)`
);
const selectByStateStmt = db.prepare(
  `SELECT id, user_id AS userId, state, created_at AS createdAt
   FROM github_oauth_states
   WHERE state = ?`
);
const deleteByIdStmt = db.prepare(`DELETE FROM github_oauth_states WHERE id = ?`);
const cleanupStmt = db.prepare(
  `DELETE FROM github_oauth_states WHERE created_at <= datetime('now', '-30 minutes')`
);

export function createOauthState(userId: number, state: string): void {
  cleanupStmt.run();
  insertStmt.run(userId, state);
}

export function consumeOauthState(userId: number, state: string): boolean {
  cleanupStmt.run();
  const record = selectByStateStmt.get(state) as OauthStateRecord | undefined;
  if (!record || record.userId !== userId) {
    return false;
  }
  deleteByIdStmt.run(record.id);
  return true;
}
