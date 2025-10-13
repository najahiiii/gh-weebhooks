import { db } from "../db";

export type Destination = {
  id: number;
  ownerUserId: number;
  chatId: string;
  title: string;
  isDefault: boolean;
  topicId: number | null;
};

const listStmt = db.prepare(
  `SELECT id, owner_user_id as ownerUserId, chat_id as chatId, title, is_default as isDefault, topic_id as topicId
   FROM destinations WHERE owner_user_id = ? ORDER BY id DESC`
);
const getStmt = db.prepare(
  `SELECT id, owner_user_id as ownerUserId, chat_id as chatId, title, is_default as isDefault, topic_id as topicId
   FROM destinations WHERE id = ?`
);
const insertStmt = db.prepare(
  `INSERT INTO destinations (owner_user_id, chat_id, title, is_default, topic_id)
   VALUES (?, ?, ?, ?, ?)`
);
const updateStmt = db.prepare(
  `UPDATE destinations SET chat_id = ?, title = ?, is_default = ?, topic_id = ? WHERE id = ?`
);
const deleteStmt = db.prepare(`DELETE FROM destinations WHERE id = ?`);
const clearDefaultStmt = db.prepare(
  `UPDATE destinations SET is_default = 0 WHERE owner_user_id = ?`
);
const setDefaultStmt = db.prepare(
  `UPDATE destinations SET is_default = 1 WHERE id = ?`
);

export function listDestinations(ownerUserId: number): Destination[] {
  const rows = listStmt.all(ownerUserId) as Array<Omit<Destination, "isDefault"> & { isDefault: number }>;
  return rows.map((row) => ({
    ...row,
    isDefault: Boolean(row.isDefault),
    topicId: row.topicId === null ? null : Number(row.topicId)
  }));
}

export function getDestination(id: number): Destination | undefined {
  const row = getStmt.get(id) as (Omit<Destination, "isDefault"> & { isDefault: number }) | undefined;
  if (!row) {
    return undefined;
  }
  return {
    ...row,
    isDefault: Boolean(row.isDefault),
    topicId: row.topicId === null ? null : Number(row.topicId)
  };
}

export function createDestination(
  ownerUserId: number,
  chatId: string,
  title: string,
  isDefault: boolean,
  topicId: number | null
): Destination {
  const insertTx = db.transaction(() => {
    if (isDefault) {
      clearDefaultStmt.run(ownerUserId);
    }
    const result = insertStmt.run(ownerUserId, chatId, title, isDefault ? 1 : 0, topicId ?? null);
    return Number(result.lastInsertRowid);
  });
  const id = insertTx();
  return {
    id,
    ownerUserId,
    chatId,
    title,
    isDefault,
    topicId
  };
}

export function updateDestination(
  ownerUserId: number,
  id: number,
  chatId: string,
  title: string,
  isDefault: boolean,
  topicId: number | null
): void {
  const updateTx = db.transaction(() => {
    if (isDefault) {
      clearDefaultStmt.run(ownerUserId);
    }
    updateStmt.run(chatId, title, isDefault ? 1 : 0, topicId ?? null, id);
  });
  updateTx();
}

export function deleteDestination(id: number): void {
  deleteStmt.run(id);
}

export function setDefaultDestination(ownerUserId: number, destinationId: number): void {
  const tx = db.transaction(() => {
    clearDefaultStmt.run(ownerUserId);
    setDefaultStmt.run(destinationId);
  });
  tx();
}
