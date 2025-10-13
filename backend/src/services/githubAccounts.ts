import { db } from "../db";

export type GithubAccount = {
  id: number;
  userId: number;
  accessToken: string;
  username: string | null;
  avatarUrl: string | null;
  scopes: string[];
  tokenType: string | null;
  createdAt: string;
  updatedAt: string;
};

const selectByUserStmt = db.prepare(
  `SELECT id,
          user_id      AS userId,
          access_token AS accessToken,
          username,
          avatar_url   AS avatarUrl,
          scopes,
          token_type   AS tokenType,
          created_at   AS createdAt,
          updated_at   AS updatedAt
   FROM github_accounts
   WHERE user_id = ?`
);

const upsertStmt = db.prepare(
  `INSERT INTO github_accounts (user_id, access_token, username, avatar_url, scopes, token_type, created_at, updated_at)
   VALUES (@userId, @accessToken, @username, @avatarUrl, @scopes, @tokenType, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
   ON CONFLICT(user_id) DO UPDATE SET
     access_token = excluded.access_token,
     username     = excluded.username,
     avatar_url   = excluded.avatar_url,
     scopes       = excluded.scopes,
     token_type   = excluded.token_type,
     updated_at   = CURRENT_TIMESTAMP`
);

const deleteStmt = db.prepare(`DELETE FROM github_accounts WHERE user_id = ?`);

function parseScopes(value: unknown): string[] {
  if (!value) {
    return [];
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item).trim())
      .filter(Boolean);
  }
  return [];
}

export function getGithubAccount(userId: number): GithubAccount | undefined {
  const row = selectByUserStmt.get(userId) as (Omit<GithubAccount, "scopes"> & { scopes: string | null }) | undefined;
  if (!row) {
    return undefined;
  }
  return {
    ...row,
    scopes: parseScopes(row.scopes)
  };
}

export function saveGithubAccount(payload: {
  userId: number;
  accessToken: string;
  username: string | null;
  avatarUrl: string | null;
  scopes: string[];
  tokenType: string | null;
}): GithubAccount {
  const scopesValue = payload.scopes.join(", ");
  upsertStmt.run({
    userId: payload.userId,
    accessToken: payload.accessToken,
    username: payload.username,
    avatarUrl: payload.avatarUrl,
    scopes: scopesValue,
    tokenType: payload.tokenType
  });
  const updated = selectByUserStmt.get(payload.userId) as (Omit<GithubAccount, "scopes"> & { scopes: string | null }) | undefined;
  if (!updated) {
    throw new Error("Failed to persist GitHub account");
  }
  return {
    ...updated,
    scopes: parseScopes(updated.scopes)
  };
}

export function deleteGithubAccount(userId: number): void {
  deleteStmt.run(userId);
}
