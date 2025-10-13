type LookupKey = string;

type LookupResult = {
  chatId: string;
  chatType: string | null;
  title: string | null;
  username: string | null;
  topicId: number | null;
  via: "forward" | "message";
  detectedAt: number;
};

type LookupState = {
  userId: number;
  botId: number;
  botTelegramId: string;
  startedAt: number;
  expiresAt: number;
  results: LookupResult[];
};

const LOOKUP_WINDOW_MS = 2 * 60 * 1000; // 2 minutes
const lookupStore = new Map<LookupKey, LookupState>();

function makeKey(userId: number, botTelegramId: string): LookupKey {
  return `${userId}:${botTelegramId}`;
}

export function startChatLookup(userId: number, botId: number, botTelegramId: string): LookupState {
  const entry: LookupState = {
    userId,
    botId,
    botTelegramId,
    startedAt: Date.now(),
    expiresAt: Date.now() + LOOKUP_WINDOW_MS,
    results: []
  };
  lookupStore.set(makeKey(userId, botTelegramId), entry);
  return entry;
}

export function setChatLookupResult(
  userId: number,
  botTelegramId: string,
  result: LookupResult
): void {
  const key = makeKey(userId, botTelegramId);
  const state = lookupStore.get(key);
  if (!state) {
    return;
  }
  const exists = state.results.some(
    (entry) =>
      entry.chatId === result.chatId &&
      (entry.topicId ?? null) === (result.topicId ?? null) &&
      entry.via === result.via
  );
  const results = exists ? state.results : [...state.results, result];
  lookupStore.set(key, {
    ...state,
    results,
    expiresAt: Date.now() + LOOKUP_WINDOW_MS
  });
}

export function clearChatLookup(userId: number, botTelegramId: string): void {
  lookupStore.delete(makeKey(userId, botTelegramId));
}

export function getChatLookupStatus(userId: number, botTelegramId: string):
  | { status: "idle" }
  | { status: "pending"; expiresAt: string; chats: LookupResult[] }
  | { status: "ready"; chats: LookupResult[] }
  | { status: "expired" } {
  const key = makeKey(userId, botTelegramId);
  const state = lookupStore.get(key);
  if (!state) {
    return { status: "idle" };
  }
  if (state.results.length > 0) {
    return { status: "ready", chats: state.results };
  }
  if (Date.now() > state.expiresAt) {
    lookupStore.delete(key);
    return { status: "expired" };
  }
  return { status: "pending", expiresAt: new Date(state.expiresAt).toISOString(), chats: state.results };
}

export function hasPendingLookup(userId: number, botTelegramId: string): boolean {
  const key = makeKey(userId, botTelegramId);
  const state = lookupStore.get(key);
  if (!state) {
    return false;
  }
  if (Date.now() > state.expiresAt) {
    lookupStore.delete(key);
    return false;
  }
  return true;
}

export type ChatLookupResult = LookupResult;
export type ChatLookupState = LookupState;
