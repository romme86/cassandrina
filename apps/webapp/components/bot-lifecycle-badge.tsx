import { cn } from "@/lib/utils";
import type { BotLifecycleState } from "@/lib/bot-control";

const BOT_STATE_STYLES: Record<BotLifecycleState, string> = {
  running: "border-primary/20 bg-primary/10 text-primary",
  paused: "border-amber-500/20 bg-amber-500/10 text-amber-300",
  stopped: "border-red-500/20 bg-red-500/10 text-red-300",
  offline: "border-white/10 bg-secondary text-muted-foreground",
};

const BOT_STATE_DOT_STYLES: Record<BotLifecycleState, string> = {
  running: "bg-primary",
  paused: "bg-amber-300",
  stopped: "bg-red-300",
  offline: "bg-muted-foreground",
};

const BOT_STATE_LABELS: Record<BotLifecycleState, string> = {
  running: "Bot Running",
  paused: "Bot Paused",
  stopped: "Bot Stopped",
  offline: "Bot Offline",
};

interface BotLifecycleBadgeProps {
  state: BotLifecycleState;
  className?: string;
}

export function BotLifecycleBadge({ state, className }: BotLifecycleBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-full border px-4 py-1.5 text-xs font-semibold",
        BOT_STATE_STYLES[state],
        className
      )}
    >
      <span className={cn("h-2 w-2 rounded-full", BOT_STATE_DOT_STYLES[state])} />
      {BOT_STATE_LABELS[state]}
    </span>
  );
}
