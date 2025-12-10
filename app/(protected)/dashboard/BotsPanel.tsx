"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { type ApiBot, type ApiWebhookInfo } from "@/lib/api";
import { Badge } from "components/ui/badge";
import { Button } from "components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "components/ui/card";
import { useMemo } from "react";

type BotDetails = { webhookInfo: ApiWebhookInfo };

type BotsPanelProps = {
  bots: ApiBot[];
  botDetails: Record<number, BotDetails | undefined>;
  loadingBotInfoId: number | null;
  newToken: string;
  setNewToken: (value: string) => void;
  dropPendingUpdatesOnCreate: boolean;
  setDropPendingUpdatesOnCreate: (value: boolean) => void;
  rotatingBotId: number | null;
  setRotatingBotId: (id: number | null) => void;
  rotateTokenValue: string;
  setRotateTokenValue: (value: string) => void;
  busyAction: string | null;
  handleAddBot: () => Promise<void>;
  handleInspectWebhook: (id: number) => Promise<void>;
  handleDropPendingUpdates: (id: number) => Promise<void>;
  handleRotateToken: (id: number) => Promise<void>;
  handleRemoveBot: (id: number) => Promise<void>;
  botIsInUse: (id: number) => boolean;
  setBotWebhookDetails: (id: number, info: ApiWebhookInfo | null) => void;
};

export function BotsPanel({
  bots,
  botDetails,
  loadingBotInfoId,
  newToken,
  setNewToken,
  dropPendingUpdatesOnCreate,
  setDropPendingUpdatesOnCreate,
  rotatingBotId,
  setRotatingBotId,
  rotateTokenValue,
  setRotateTokenValue,
  busyAction,
  handleAddBot,
  handleInspectWebhook,
  handleDropPendingUpdates,
  handleRotateToken,
  handleRemoveBot,
  botIsInUse,
  setBotWebhookDetails,
}: BotsPanelProps) {
  const botCountLabel = useMemo(
    () =>
      bots.length === 0
        ? "No bots yet"
        : `${bots.length.toLocaleString()} bot${bots.length > 1 ? "s" : ""}`,
    [bots.length]
  );

  return (
    <Card className="border-slate-800/60 bg-slate-950/75" id="bot-token">
      <CardHeader>
        <CardTitle>Bots</CardTitle>
        <CardDescription>
          Add BotFather tokens to forward GitHub events through Telegram bots.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-3 md:grid-cols-[2fr,1fr]">
          <div className="space-y-3 rounded-2xl border border-slate-800/70 bg-slate-900/60 p-4">
            <Label htmlFor="bot-token-input">BotFather token</Label>
            <Input
              id="bot-token-input"
              placeholder="123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11"
              value={newToken}
              onChange={(event) => setNewToken(event.target.value)}
            />
            <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-slate-400">
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-slate-700 bg-slate-900 accent-sky-400"
                  checked={dropPendingUpdatesOnCreate}
                  onChange={(event) =>
                    setDropPendingUpdatesOnCreate(event.target.checked)
                  }
                />
                Drop pending updates on create
              </label>
              <Button
                size="sm"
                onClick={() => void handleAddBot()}
                disabled={!newToken || busyAction === "add-bot"}>
                {busyAction === "add-bot" ? "Adding…" : "Add bot"}
              </Button>
            </div>
          </div>
          <div className="rounded-2xl border border-slate-800/70 bg-slate-900/60 p-4 text-sm text-slate-300">
            <p className="font-semibold text-slate-100">Tips</p>
            <p className="mt-2 text-xs text-slate-400">
              Ensure the bot is added as admin to target chats or topics. You
              can drop pending updates if you reused a token.
            </p>
            <p className="mt-2 text-xs text-slate-400">
              Status: {botCountLabel}
            </p>
          </div>
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-100">
              Registered bots
            </p>
            <Badge
              variant="default"
              className="text-[10px] uppercase tracking-wide">
              {botCountLabel}
            </Badge>
          </div>
          {bots.length > 0 ? (
            <div className="grid gap-3 md:grid-cols-2">
              {bots.map((bot) => {
                const details = botDetails[bot.id];
                const isRotating = rotatingBotId === bot.id;
                return (
                  <Card
                    key={bot.id}
                    className="border-slate-800/60 bg-slate-900/70 p-4 text-sm text-slate-300 shadow-sm shadow-black/20">
                    <div className="flex flex-col gap-3">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="text-base font-semibold text-slate-100">
                              {bot.displayName || bot.botId}
                            </p>
                            <Badge
                              variant="default"
                              className="font-mono text-[10px]">
                              ID {bot.botId}
                            </Badge>
                          </div>
                          <p className="text-[11px] text-slate-500">
                            Token stored encrypted at rest
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleInspectWebhook(bot.id)}
                            disabled={loadingBotInfoId === bot.id}>
                            {loadingBotInfoId === bot.id
                              ? "Loading…"
                              : "Inspect webhook"}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDropPendingUpdates(bot.id)}
                            disabled={busyAction === `drop-updates-${bot.id}`}>
                            {busyAction === `drop-updates-${bot.id}`
                              ? "Dropping…"
                              : "Drop pending"}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setRotatingBotId(bot.id);
                              setRotateTokenValue("");
                            }}>
                            Rotate token
                          </Button>
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => handleRemoveBot(bot.id)}
                            disabled={
                              busyAction === `delete-bot-${bot.id}` ||
                              botIsInUse(bot.id)
                            }
                            title={
                              botIsInUse(bot.id)
                                ? "Remove linked subscriptions first"
                                : undefined
                            }>
                            {busyAction === `delete-bot-${bot.id}`
                              ? "Removing…"
                              : "Remove"}
                          </Button>
                        </div>
                      </div>

                      {isRotating && (
                        <div className="rounded-2xl border border-slate-800/60 bg-slate-900/70 p-3 text-xs text-slate-200">
                          <p className="font-semibold text-slate-100">
                            New token
                          </p>
                          <Input
                            placeholder="Paste new token"
                            value={rotateTokenValue}
                            onChange={(event) =>
                              setRotateTokenValue(event.target.value)
                            }
                          />
                          <div className="mt-2 flex gap-2">
                            <Button
                              size="sm"
                              onClick={() => void handleRotateToken(bot.id)}
                              disabled={
                                !rotateTokenValue ||
                                busyAction === `rotate-bot-${bot.id}`
                              }>
                              {busyAction === `rotate-bot-${bot.id}`
                                ? "Rotating…"
                                : "Save token"}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setRotatingBotId(null)}>
                              Cancel
                            </Button>
                          </div>
                        </div>
                      )}

                      {details?.webhookInfo && (
                        <div className="rounded-2xl border border-slate-800/70 bg-slate-950/60 p-4 text-xs text-slate-300">
                          <div className="mb-2 flex items-center justify-between">
                            <p className="font-semibold text-slate-100">
                              Webhook insight
                            </p>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setBotWebhookDetails(bot.id, null)}
                              className="text-[11px] text-slate-400 hover:text-slate-100">
                              ✕
                            </Button>
                          </div>
                          <pre className="whitespace-pre-wrap break-all text-[11px] text-slate-200">
                            {JSON.stringify(details.webhookInfo, null, 2)}
                          </pre>
                        </div>
                      )}
                    </div>
                  </Card>
                );
              })}
            </div>
          ) : (
            <div className="flex min-h-[200px] items-center justify-center rounded-xl border border-dashed border-slate-800/70 bg-slate-900/40 px-4 text-center text-sm text-slate-400">
              No bots registered yet. Add a BotFather token to begin routing
              messages.
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
