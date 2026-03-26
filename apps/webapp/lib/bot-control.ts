const BOT_STATE_VALUES = ["running", "paused", "stopped"] as const;

export type BotLifecycleState = (typeof BOT_STATE_VALUES)[number] | "offline";

export interface BotControlStatus {
  desiredState: (typeof BOT_STATE_VALUES)[number];
  actualState: BotLifecycleState;
  heartbeatAt: string | null;
  isResponsive: boolean;
  tradingEnabled: boolean;
}

export const BOT_HEARTBEAT_STALE_MS = 45_000;

export function normalizeBotState(
  value: string | undefined,
  fallback: (typeof BOT_STATE_VALUES)[number] = "running"
): (typeof BOT_STATE_VALUES)[number] {
  return BOT_STATE_VALUES.includes(value as (typeof BOT_STATE_VALUES)[number])
    ? (value as (typeof BOT_STATE_VALUES)[number])
    : fallback;
}

export function deriveBotControlStatus(config: Record<string, string>): BotControlStatus {
  const desiredState = normalizeBotState(config.bot_desired_state, "running");
  const rawActualState = normalizeBotState(config.bot_actual_state, desiredState);
  const heartbeatValue = config.bot_heartbeat_at?.trim();
  const heartbeatAt =
    heartbeatValue && !Number.isNaN(Date.parse(heartbeatValue)) ? heartbeatValue : null;
  const isResponsive =
    heartbeatAt != null && Date.now() - Date.parse(heartbeatAt) <= BOT_HEARTBEAT_STALE_MS;

  return {
    desiredState,
    actualState: isResponsive ? rawActualState : "offline",
    heartbeatAt,
    isResponsive,
    tradingEnabled: config.trading_enabled === "true",
  };
}
