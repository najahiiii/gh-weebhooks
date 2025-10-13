import Database from "better-sqlite3";
import path from "node:path";
import { config } from "./config";

function resolveSqlitePath(url: string): string {
  if (url.startsWith("sqlite:///")) {
    const relative = url.replace("sqlite:///", "");
    return path.resolve(process.cwd(), "..", relative);
  }
  if (url.startsWith("sqlite://")) {
    return path.resolve(process.cwd(), "..", url.replace("sqlite://", ""));
  }
  return url;
}

const dbPath = resolveSqlitePath(config.databaseUrl);
export const db = new Database(dbPath);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

function addColumn(table: string, definition: string) {
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
  } catch (error) {
    if (error instanceof Error && error.message.includes("duplicate column name")) {
      return;
    }
    throw error;
  }
}

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_user_id TEXT UNIQUE,
  username TEXT,
  first_seen_at TEXT DEFAULT CURRENT_TIMESTAMP,
  is_admin INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS bots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_user_id INTEGER,
  bot_id TEXT,
  token TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(owner_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS destinations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_user_id INTEGER,
  chat_id TEXT,
  title TEXT DEFAULT '',
  is_default INTEGER DEFAULT 0,
  topic_id INTEGER,
  FOREIGN KEY(owner_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_user_id INTEGER,
  hook_id TEXT UNIQUE,
  secret TEXT,
  repo TEXT,
  events_csv TEXT DEFAULT '*',
  bot_id INTEGER,
  destination_id INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(owner_user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY(bot_id) REFERENCES bots(id) ON DELETE SET NULL,
  FOREIGN KEY(destination_id) REFERENCES destinations(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS admin_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  token TEXT UNIQUE,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS webhook_event_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  subscription_id INTEGER,
  hook_id TEXT,
  event_type TEXT,
  repository TEXT DEFAULT '',
  status TEXT DEFAULT 'success',
  summary TEXT DEFAULT '',
  payload TEXT DEFAULT '',
  error_message TEXT,
  FOREIGN KEY(subscription_id) REFERENCES subscriptions(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS github_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE,
  access_token TEXT NOT NULL,
  username TEXT,
  avatar_url TEXT,
  scopes TEXT,
  token_type TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS github_oauth_states (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  state TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
`);

addColumn("subscriptions", "github_hook_id TEXT");
addColumn("subscriptions", "github_hook_url TEXT");
addColumn("subscriptions", "github_sync_status TEXT DEFAULT 'not_attempted'");
addColumn("subscriptions", "github_sync_error TEXT DEFAULT ''");
addColumn("subscriptions", "github_synced_at TEXT");

export type UserRecord = {
  id: number;
  telegram_user_id: string;
  username: string | null;
  first_seen_at: string;
  is_admin: number;
};

export function transaction<T>(fn: () => T): T {
  const trx = db.transaction(fn);
  return trx();
}
