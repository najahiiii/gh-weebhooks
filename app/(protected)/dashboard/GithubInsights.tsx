"use client";

import { Badge } from "components/ui/badge";
import { Button } from "components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "components/ui/card";
import { Github } from "lucide-react";

export function GithubInsights({ onOpenStats }: { onOpenStats: () => void }) {
  return (
    <Card className="border-slate-800/60 bg-slate-950/75">
      <CardHeader className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2">
            <Github className="h-5 w-5 text-sky-300" />
            GitHub insights
          </CardTitle>
          <CardDescription>
            See delivery totals, webhook stats, and failure rates.
          </CardDescription>
        </div>
        <div className="flex gap-2">
          <Badge variant="sky" className="text-[10px] uppercase tracking-wide">
            Live
          </Badge>
          <Button variant="secondary" size="sm" onClick={onOpenStats}>
            Open stats
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-2 text-sm text-slate-300">
        <p>
          Use the stats page to check webhook counts, success/error trends, and
          subscription totals across your workspaces.
        </p>
        <p className="text-xs text-slate-500">
          Tip: add GitHub auto-sync to keep repository hooks up to date.
        </p>
      </CardContent>
    </Card>
  );
}
