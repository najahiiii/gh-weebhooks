import axios from "axios";
import { config } from "../config";

export async function sendTelegramMessage(
  token: string,
  chatId: string,
  text: string,
  topicId?: number | null
): Promise<void> {
  const url = `${config.telegramApiBase}/bot${token}/sendMessage`;
  const payload: Record<string, unknown> = {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true
  };
  if (topicId) {
    payload.message_thread_id = topicId;
  }
  await axios.post(url, payload, { timeout: 10000 });
}

export async function sendTelegramMarkdownMessage(
  token: string,
  chatId: string,
  text: string,
  options?: { topicId?: number | null; disablePreview?: boolean }
): Promise<void> {
  const url = `${config.telegramApiBase}/bot${token}/sendMessage`;
  const payload: Record<string, unknown> = {
    chat_id: chatId,
    text: escapeMarkdownV2(text),
    parse_mode: "MarkdownV2",
    disable_web_page_preview: options?.disablePreview ?? true
  };
  if (options?.topicId) {
    payload.message_thread_id = options.topicId;
  }
  await axios.post(url, payload, { timeout: 10000 });
}

const MARKDOWN_V2_SPECIAL = /[\\_\*\[\]\(\)~`>#+\-=|{}\.\!]/g;

function escapeMarkdownV2(input: string): string {
  return input.replace(MARKDOWN_V2_SPECIAL, (match) => `\\${match}`);
}

export async function setTelegramWebhook(
  token: string,
  webhookUrl: string,
  options?: { dropPendingUpdates?: boolean }
): Promise<boolean> {
  const url = `${config.telegramApiBase}/bot${token}/setWebhook`;
  const payload: Record<string, unknown> = { url: webhookUrl };
  if (options?.dropPendingUpdates) {
    payload.drop_pending_updates = true;
  }
  try {
    const response = await axios.post(url, payload, { timeout: 10000 });
    return Boolean(response.data?.ok);
  } catch (error) {
    return false;
  }
}

export async function fetchTelegramBotLabel(token: string): Promise<string | null> {
  const url = `${config.telegramApiBase}/bot${token}/getMe`;
  try {
    const response = await axios.get(url, { timeout: 10000 });
    const data = response.data;
    if (!data?.ok) {
      return null;
    }
    const username = data.result?.username as string | undefined;
    if (username && username.trim()) {
      return username.startsWith("@") ? username : `@${username}`;
    }
    const firstName = data.result?.first_name as string | undefined;
    if (firstName && firstName.trim()) {
      return firstName;
    }
    return null;
  } catch {
    return null;
  }
}

export async function fetchTelegramWebhookInfo(token: string): Promise<Record<string, unknown> | null> {
  const url = `${config.telegramApiBase}/bot${token}/getWebhookInfo`;
  try {
    const response = await axios.get(url, { timeout: 10000 });
    return response.data ?? null;
  } catch {
    return null;
  }
}
