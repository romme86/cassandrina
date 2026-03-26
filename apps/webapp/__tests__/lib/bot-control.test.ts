import { deriveBotControlStatus } from "@/lib/bot-control";

describe("deriveBotControlStatus", () => {
  test("returns offline when heartbeat is missing", () => {
    expect(
      deriveBotControlStatus({
        bot_desired_state: "running",
        bot_actual_state: "running",
        trading_enabled: "true",
      })
    ).toEqual({
      desiredState: "running",
      actualState: "offline",
      heartbeatAt: null,
      isResponsive: false,
      tradingEnabled: true,
    });
  });

  test("returns the reported runtime state when heartbeat is fresh", () => {
    const heartbeatAt = new Date().toISOString();

    expect(
      deriveBotControlStatus({
        bot_desired_state: "paused",
        bot_actual_state: "paused",
        bot_heartbeat_at: heartbeatAt,
        trading_enabled: "false",
      })
    ).toEqual({
      desiredState: "paused",
      actualState: "paused",
      heartbeatAt,
      isResponsive: true,
      tradingEnabled: false,
    });
  });
});
