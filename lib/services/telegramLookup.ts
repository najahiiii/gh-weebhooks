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

export type LookupEvent =
  | { type: "started"; expiresAt: number }
  | { type: "detected"; chat: LookupResult }
  | { type: "cleared" }
  | { type: "expired" };

const LOOKUP_WINDOW_MS = 2 * 60 * 1000; // 2 minutes
const lookupStore = new Map<LookupKey, LookupState>();
const listeners = new Map<LookupKey, Set<(payload: LookupEvent) => void>>();

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
  emitToListeners(userId, botTelegramId, { type: "started", expiresAt: entry.expiresAt });
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
  emitToListeners(userId, botTelegramId, { type: "detected", chat: result });
}

export function clearChatLookup(userId: number, botTelegramId: string): void {
  lookupStore.delete(makeKey(userId, botTelegramId));
  emitToListeners(userId, botTelegramId, { type: "cleared" });
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
    emitToListeners(userId, botTelegramId, { type: "expired" });
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

export function getPendingLookupForBot(botTelegramId: string): LookupState | null {
  for (const [key, state] of lookupStore.entries()) {
    if (state.botTelegramId !== botTelegramId) continue;
    if (Date.now() > state.expiresAt) {
      lookupStore.delete(key);
      continue;
    }
    return state;
  }
  return null;
}

export function hasPendingLookupForBot(botTelegramId: string): boolean {
  return Boolean(getPendingLookupForBot(botTelegramId));
}

export function addLookupListener(
  userId: number,
  botTelegramId: string,
  listener: (payload: LookupEvent) => void
): () => void {
  const key = makeKey(userId, botTelegramId);
  const set = listeners.get(key) ?? new Set<(payload: LookupEvent) => void>();
  set.add(listener);
  listeners.set(key, set);
  return () => {
    const current = listeners.get(key);
    if (!current) return;
    current.delete(listener);
    if (current.size === 0) {
      listeners.delete(key);
    }
  };
}

function emitToListeners(userId: number, botTelegramId: string, payload: LookupEvent) {
  const key = makeKey(userId, botTelegramId);
  const set = listeners.get(key);
  if (!set || set.size === 0) return;
  for (const listener of set) {
    try {
      listener(payload);
    } catch (err) {
      console.warn("[chat-lookup] listener error", err);
    }
  }
}

export type ChatLookupResult = LookupResult;
export type ChatLookupState = LookupState;
