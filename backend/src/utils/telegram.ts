export function parseBotIdFromToken(token: string): string | null {
  if (!token.includes(":")) {
    return null;
  }
  const [botId] = token.split(":", 1);
  return botId || null;
}

export function parseTopicId(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value), 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}
