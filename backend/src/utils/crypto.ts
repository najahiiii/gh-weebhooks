import crypto from "node:crypto";
import { config } from "../config";

const TELEGRAM_LOGIN_TTL_SECONDS = 5 * 60;

export function verifyTelegramLogin(data: Record<string, unknown>, botToken: string): boolean {
  if (!botToken) {
    console.warn("[telegram-login] missing LOGIN_BOT_TOKEN");
    return false;
  }

  const providedHash = typeof data.hash === "string" ? data.hash : "";
  if (!providedHash) {
    console.warn("[telegram-login] payload missing hash");
    return false;
  }

  const rawAuthDate = data.auth_date;
  const authDate = typeof rawAuthDate === "number" ? rawAuthDate : Number.parseInt(String(rawAuthDate ?? ""), 10);
  if (!Number.isFinite(authDate)) {
    console.warn("[telegram-login] invalid auth_date", { rawAuthDate });
    return false;
  }
  const offset = Number.isFinite(config.telegramLoginClockSkewSeconds)
    ? config.telegramLoginClockSkewSeconds
    : 0;
  const ttl = Number.isFinite(config.telegramLoginTtlSeconds)
    ? config.telegramLoginTtlSeconds
    : TELEGRAM_LOGIN_TTL_SECONDS;
  const currentTime = Math.floor(Date.now() / 1000) + offset;
  if (ttl > 0 && Math.abs(currentTime - authDate) > ttl) {
    console.warn("[telegram-login] auth_date outside TTL", {
      authDate,
      currentTime,
      delta: currentTime - authDate,
      ttl,
    });
    return false;
  }

  const checkData: Record<string, string> = {};
  for (const [key, value] of Object.entries(data)) {
    if (key === "hash") {
      continue;
    }
    if (value === undefined || value === null) {
      continue;
    }
    checkData[key] = String(value);
  }

  const sortedKeys = Object.keys(checkData).sort();
  const dataCheckString = sortedKeys.map((key) => `${key}=${checkData[key]}`).join("\n");

  const secretKey = crypto.createHash("sha256").update(botToken).digest();
  const computedHash = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

  try {
    const match = crypto.timingSafeEqual(Buffer.from(computedHash, "hex"), Buffer.from(providedHash, "hex"));
    if (!match && process.env.NODE_ENV !== "production") {
      console.warn("[telegram-login] signature mismatch", {
        dataCheckString,
        computedHash,
        providedHash,
      });
    }
    return match;
  } catch {
    return false;
  }
}

export function verifyGithubSignature(secret: string, body: Buffer, signatureHeader?: string | null): boolean {
  if (!signatureHeader) {
    return false;
  }
  const expected = crypto
    .createHmac("sha256", secret)
    .update(body)
    .digest("hex");
  const signature = signatureHeader.replace("sha256=", "");
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

export function randomToken(size = 48): string {
  return crypto.randomBytes(size).toString("base64url");
}
