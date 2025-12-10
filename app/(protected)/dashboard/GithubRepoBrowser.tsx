"use client";

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Spinner } from "@/components/ui/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { type ApiGithubRepo, type ApiGithubWebhook } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Badge } from "components/ui/badge";
import { Button } from "components/ui/button";
import { Check, ChevronsUpDown, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

type GithubRepoBrowserProps = {
  value: string;
  onSelect: (repoFullName: string) => void;
  isGithubConnected: boolean;
  loadingGithubStatus: boolean;
  githubAccountUsername: string;
  githubRepos: ApiGithubRepo[];
  loadingGithubRepos: boolean;
  githubWebhooksMap: Record<string, ApiGithubWebhook[]>;
  githubWebhookErrors: Record<string, string>;
  githubWebhooksLoading: boolean;
  githubWebhooksExhausted: boolean;
  githubConnecting: boolean;
  githubDisconnecting: boolean;
  onConnectGithub: () => void | Promise<void>;
  onDisconnectGithub: () => void | Promise<void>;
  onRefreshRepos: (options?: {
    notifyIfDisconnected?: boolean;
    force?: boolean;
    silent?: boolean;
  }) => void | Promise<void>;
  onRefreshWebhooks: (options?: {
    silent?: boolean;
    perPage?: number;
    maxPages?: number;
    force?: boolean;
  }) => void | Promise<void>;
  githubWebhooksFetched: boolean;
};

export function GithubRepoBrowser({
  value,
  onSelect,
  isGithubConnected,
  loadingGithubStatus,
  githubAccountUsername,
  githubRepos,
  loadingGithubRepos,
  githubWebhooksMap,
  githubWebhookErrors,
  githubWebhooksLoading,
  githubWebhooksExhausted,
  githubConnecting,
  githubDisconnecting,
  onConnectGithub,
  onDisconnectGithub,
  onRefreshRepos,
  onRefreshWebhooks,
  githubWebhooksFetched,
}: GithubRepoBrowserProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const selected = githubRepos.find((repo) => repo.fullName === value) ?? null;
  const repoKey = selected?.fullName ?? value;
  const repoHooks = repoKey ? githubWebhooksMap[repoKey] : undefined;
  const repoHookError = repoKey ? githubWebhookErrors[repoKey] : undefined;

  useEffect(() => {
    if (!open) {
      return;
    }
    const listener = (event: MouseEvent) => {
      if (
        !containerRef.current ||
        containerRef.current.contains(event.target as Node)
      ) {
        return;
      }
      setOpen(false);
    };
    document.addEventListener("mousedown", listener);
    return () => document.removeEventListener("mousedown", listener);
  }, [open]);

  if (loadingGithubStatus && !isGithubConnected) {
    return (
      <div className="rounded-2xl border border-slate-800/60 bg-slate-950/50 p-4 text-xs text-slate-400">
        Checking GitHub connection…
      </div>
    );
  }

  if (!isGithubConnected) {
    return (
      <div className="space-y-2 rounded-2xl border border-slate-800/60 bg-slate-950/50 p-4 text-xs text-slate-400">
        <p>Connect GitHub to browse and select repositories automatically.</p>
        <Button
          size="sm"
          onClick={() => void onConnectGithub()}
          disabled={githubConnecting || loadingGithubStatus}>
          {githubConnecting ? "Opening…" : "Connect GitHub"}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
        <span className="font-medium text-slate-300">
          Connected as{" "}
          {githubAccountUsername ? `@${githubAccountUsername}` : "GitHub user"}
        </span>
        <Button
          variant="secondary"
          size="sm"
          onClick={() =>
            void onRefreshRepos({ notifyIfDisconnected: true, force: true })
          }
          disabled={loadingGithubRepos}>
          {loadingGithubRepos && <Spinner className="mr-2 h-4 w-4" />} Refresh
          repos
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void onRefreshWebhooks({ force: true })}
          disabled={githubWebhooksLoading}>
          {githubWebhooksLoading && <Spinner className="mr-2 h-4 w-4" />} Sync
          webhooks
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void onDisconnectGithub()}
          disabled={githubDisconnecting}>
          {githubDisconnecting ? "Disconnecting…" : "Disconnect"}
        </Button>
      </div>
      <div ref={containerRef} className="relative">
        <Button
          variant="outline"
          type="button"
          role="combobox"
          aria-expanded={open}
          onClick={() => {
            setOpen((prev) => {
              const next = !prev;
              if (next) {
                if (githubRepos.length === 0 && !loadingGithubRepos) {
                  void onRefreshRepos({ silent: true });
                }
                if (!githubWebhooksFetched && !githubWebhooksLoading) {
                  void onRefreshWebhooks({ silent: true });
                }
              }
              return next;
            });
          }}
          className={cn(
            "w-full justify-between border-slate-800/70 bg-slate-950/60 text-left text-sm font-medium text-slate-200",
            selected ? "" : "text-slate-500"
          )}>
          <span className="flex min-w-0 flex-col">
            {selected ? (
              <>
                <span className="truncate text-sm text-slate-100">
                  {selected.fullName}
                </span>
                <span className="truncate text-xs text-slate-500">
                  {selected.description ||
                    (selected.private ? "Private" : "Public repository")}
                </span>
              </>
            ) : (
              "Select repository"
            )}
          </span>
          {loadingGithubRepos ? (
            <Loader2 className="ml-2 h-4 w-4 animate-spin text-slate-400" />
          ) : (
            <ChevronsUpDown className="ml-2 h-4 w-4 text-slate-500" />
          )}
        </Button>
        {open ? (
          <div className="absolute left-0 right-0 top-full z-50 mt-2 max-h-64 overflow-hidden rounded-xl border border-slate-800/70 bg-slate-950/95 text-slate-100 shadow-xl shadow-slate-950/40">
            <Command className="border-none">
              <CommandInput placeholder="Search repository…" className="px-3" />
              <CommandList className="max-h-56 overflow-y-auto">
                <CommandEmpty>
                  {loadingGithubRepos ? (
                    <span className="flex items-center justify-center gap-2 text-slate-400">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading repositories…
                    </span>
                  ) : (
                    "No repository found."
                  )}
                </CommandEmpty>
                <CommandGroup heading="Repositories" className="mt-1 space-y-1">
                  {githubRepos.map((repo) => (
                    <CommandItem
                      key={repo.fullName}
                      value={repo.fullName}
                      onSelect={(currentValue) => {
                        onSelect(currentValue);
                        setOpen(false);
                      }}>
                      <Check
                        className={cn(
                          "h-4 w-4 text-sky-400",
                          repo.fullName === value ? "opacity-100" : "opacity-0"
                        )}
                      />
                      <div className="flex flex-col gap-0.5">
                        <span className="text-sm font-medium text-slate-100">
                          {repo.fullName}
                        </span>
                        {repo.description && (
                          <span className="text-xs text-slate-400">
                            {repo.description}
                          </span>
                        )}
                        <span className="text-xs text-slate-500">
                          {repo.private ? "Private" : "Public"}
                        </span>
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </div>
        ) : null}
      </div>
      <div className="mt-3 space-y-3">
        <div className="flex items-center justify-between text-[11px] text-slate-400">
          <span>
            Webhooks detected{repoKey ? ` · ${repoHooks?.length ?? 0}` : ""}
          </span>
          {githubWebhooksExhausted && (
            <span className="text-amber-300">Partial list (page limit)</span>
          )}
        </div>
        <div
          className="max-h-[315px] space-y-3 overflow-y-auto pr-1"
          style={{ scrollbarGutter: "stable" }}>
          {githubWebhooksLoading && !repoHooks ? (
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin" />
              Syncing webhooks…
            </div>
          ) : repoHookError ? (
            <div className="text-xs text-red-300">{repoHookError}</div>
          ) : repoKey ? (
            repoHooks && repoHooks.length > 0 ? (
              <div className="space-y-3">
                {repoHooks.map((hook) => (
                  <div
                    key={`${repoKey}-${hook.id || hook.url}`}
                    className="rounded-xl border border-slate-800/60 bg-slate-950/70 p-3 text-xs text-slate-300">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium text-slate-100">
                        {hook.url || "(no URL)"}
                      </span>
                      <Badge
                        variant={hook.authorized ? "emerald" : "destructive"}
                        className="text-[10px] uppercase tracking-wide">
                        {hook.authorized ? "Authorized" : "Unauthorized"}
                      </Badge>
                    </div>
                    <TooltipProvider delayDuration={150}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-400">
                            <span className="truncate">
                              {hook.events.length > 0
                                ? hook.events.slice(0, 3).join(", ")
                                : "No events"}
                              {hook.events.length > 3
                                ? ` (+${hook.events.length - 3})`
                                : ""}
                            </span>
                            <span>•</span>
                            <span>{hook.active ? "Active" : "Inactive"}</span>
                            {hook.subscriptionHookId && (
                              <>
                                <span>•</span>
                                <span>
                                  Subscription {hook.subscriptionHookId}
                                </span>
                              </>
                            )}
                          </div>
                        </TooltipTrigger>
                        {hook.events.length > 3 && (
                          <TooltipContent>
                            <div className="max-w-xs text-left text-[11px] leading-relaxed text-slate-100">
                              <p className="font-semibold text-slate-200">
                                Subscribed events
                              </p>
                              <p>{hook.events.join(", ")}</p>
                            </div>
                          </TooltipContent>
                        )}
                      </Tooltip>
                    </TooltipProvider>
                    {hook.createdAt && (
                      <div className="mt-1 text-[10px] text-slate-500">
                        Created {hook.createdAt}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : githubWebhooksLoading ? (
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading webhooks…
              </div>
            ) : (
              <div className="text-xs text-slate-500">
                No webhooks detected for this repository.
              </div>
            )
          ) : (
            <div className="text-xs text-slate-500">
              Select a repository to inspect existing webhooks.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
