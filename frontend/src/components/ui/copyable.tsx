"use client";

import { useState } from "react";
import { toast } from "./sonner";
import { cn } from "../../lib/utils";

type CopyableProps = {
  value: string;
  label?: string;
  className?: string;
  copyLabel?: string;
  successMessage?: string;
  truncated?: boolean;
};

export function Copyable({
  value,
  label,
  className,
  copyLabel = "Copy",
  successMessage = "Copied to clipboard",
  truncated = false
}: CopyableProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success(successMessage);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Failed to copy");
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={cn(
        "group flex w-full items-center gap-2 rounded-xl border border-slate-800/70 bg-slate-900/60 px-3 py-2 text-left",
        "transition hover:border-sky-500/40 hover:bg-slate-900/80",
        className
      )}
    >
      <div className="flex-1 space-y-1">
        {label ? <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</p> : null}
        <p className={cn("font-mono text-xs text-slate-100", truncated && "truncate")}>{value}</p>
      </div>
      <span className="text-[10px] uppercase tracking-wide text-sky-300 transition group-hover:text-sky-200">
        {copied ? "Copied" : copyLabel}
      </span>
    </button>
  );
}
