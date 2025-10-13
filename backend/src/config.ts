import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";

const envPaths: string[] = [];
if (process.env.BACKEND_ENV_PATH) {
  envPaths.push(process.env.BACKEND_ENV_PATH);
} else {
  envPaths.push(path.resolve(process.cwd(), ".env"));
  envPaths.push(path.resolve(process.cwd(), "../.env"));
}

for (const candidate of envPaths) {
  if (candidate && fs.existsSync(candidate)) {
    dotenv.config({ path: candidate });
    break;
  }
}

function requireEnv(name: string, fallback?: string) {
  const value = process.env[name];
  if (value === undefined || value === "") {
    if (fallback !== undefined) {
      return fallback;
    }
    throw new Error(`Missing environment variable ${name}`);
  }
  return value;
}

export const config = {
  port: Number.parseInt(process.env.PORT || "4000", 10),
  databaseUrl: requireEnv("DB_URL", "sqlite:///./github_tg.sqlite3"),
  publicBaseUrl: requireEnv("PUBLIC_BASE_URL", "http://localhost:4000"),
  adminIds: (process.env.ADMIN_USER_IDS || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean),
  loginBotToken: process.env.LOGIN_BOT_TOKEN || "",
  loginBotUsername: process.env.LOGIN_BOT_USERNAME || "",
  sessionCookieName: process.env.SESSION_COOKIE_NAME || "app_session",
  sessionDurationHours: Number.parseFloat(process.env.SESSION_DURATION_HOURS || "24"),
  timezone: process.env.TIMEZONE || "Asia/Jakarta",
  telegramApiBase: process.env.TELEGRAM_API_BASE || "https://api.telegram.org",
  telegramLoginClockSkewSeconds: Number.parseInt(process.env.TELEGRAM_LOGIN_CLOCK_SKEW_SECONDS || "0", 10),
  telegramLoginTtlSeconds: Number.parseInt(process.env.TELEGRAM_LOGIN_TTL_SECONDS || "300", 10),
  frontendBaseUrl: requireEnv("FRONTEND_BASE_URL", "http://localhost:3000"),
  githubClientId: process.env.GITHUB_CLIENT_ID || "",
  githubClientSecret: process.env.GITHUB_CLIENT_SECRET || "",
  githubScopes: process.env.GITHUB_SCOPES || "repo admin:repo_hook",
  githubAutoWebhook: process.env.GITHUB_AUTO_WEBHOOK !== "false",
  githubUserAgent: process.env.GITHUB_USER_AGENT || "gh-weebhooks"
};

type Config = typeof config;
export type { Config };
