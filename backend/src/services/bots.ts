import { db } from "../db";

export type Bot = {
  id: number;
  ownerUserId: number;
  botId: string;
  token: string;
  createdAt: string;
};

const selectBotsForUser = db.prepare(
  `SELECT id, owner_user_id as ownerUserId, bot_id as botId, token, created_at as createdAt
   FROM bots WHERE owner_user_id = ? ORDER BY created_at DESC`
);
const selectBotById = db.prepare(
  `SELECT id, owner_user_id as ownerUserId, bot_id as botId, token, created_at as createdAt
   FROM bots WHERE id = ?`
);
const selectBotByTelegramId = db.prepare(
  `SELECT id, owner_user_id as ownerUserId, bot_id as botId, token, created_at as createdAt
   FROM bots WHERE bot_id = ?`
);
const insertBot = db.prepare(
  `INSERT INTO bots (owner_user_id, bot_id, token, created_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)`
);
const updateBotTokenStmt = db.prepare(
  `UPDATE bots SET token = ? WHERE id = ?`
);
const deleteBotStmt = db.prepare(`DELETE FROM bots WHERE id = ?`);

export function listBots(ownerUserId: number): Bot[] {
  return selectBotsForUser.all(ownerUserId) as Bot[];
}

export function getBot(botId: number): Bot | undefined {
  return selectBotById.get(botId) as Bot | undefined;
}

export function getBotByTelegramId(botId: string): Bot | undefined {
  return selectBotByTelegramId.get(botId) as Bot | undefined;
}

export function createBot(ownerUserId: number, botId: string, token: string): Bot {
  const result = insertBot.run(ownerUserId, botId, token);
  const id = Number(result.lastInsertRowid);
  return {
    id,
    ownerUserId,
    botId,
    token,
    createdAt: new Date().toISOString()
  };
}

export function updateBotToken(id: number, token: string): void {
  updateBotTokenStmt.run(token, id);
}

export function deleteBot(id: number): void {
  deleteBotStmt.run(id);
}
