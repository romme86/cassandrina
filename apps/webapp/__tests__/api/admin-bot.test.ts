/** @jest-environment node */

import { NextRequest } from "next/server";

const mockIsAdminRequest = jest.fn();
const mockQuery = jest.fn();
const txQuery = jest.fn();
const mockWithTransaction = jest.fn(
  async (fn: (client: { query: typeof txQuery }) => Promise<unknown>) => fn({ query: txQuery })
);

jest.mock("@/lib/admin", () => ({
  isAdminRequest: (...args: unknown[]) => mockIsAdminRequest(...args),
}));

jest.mock("@/lib/db", () => ({
  query: (...args: unknown[]) => mockQuery(...args),
  withTransaction: (...args: unknown[]) => mockWithTransaction(...args),
}));

import { GET, POST } from "@/app/api/admin/bot/route";

beforeEach(() => {
  jest.clearAllMocks();
  mockIsAdminRequest.mockReturnValue(true);
});

describe("GET /api/admin/bot", () => {
  test("returns 401 without admin auth", async () => {
    mockIsAdminRequest.mockReturnValue(false);

    const res = await GET(new NextRequest("http://localhost/api/admin/bot"));
    expect(res.status).toBe(401);
  });

  test("returns derived bot status", async () => {
    const heartbeatAt = new Date().toISOString();
    mockQuery.mockResolvedValueOnce([
      { key: "bot_desired_state", value: "running" },
      { key: "bot_actual_state", value: "running" },
      { key: "bot_heartbeat_at", value: heartbeatAt },
      { key: "trading_enabled", value: "true" },
    ]);

    const res = await GET(new NextRequest("http://localhost/api/admin/bot"));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      desiredState: "running",
      actualState: "running",
      heartbeatAt,
      isResponsive: true,
      tradingEnabled: true,
    });
  });
});

describe("POST /api/admin/bot", () => {
  function makeRequest(body: unknown) {
    return new NextRequest("http://localhost/api/admin/bot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  test("returns 422 for invalid actions", async () => {
    const res = await POST(makeRequest({ action: "resume" }));
    expect(res.status).toBe(422);
  });

  test("writes restart controls and returns refreshed status", async () => {
    const heartbeatAt = new Date().toISOString();
    mockQuery.mockResolvedValueOnce([
      { key: "bot_desired_state", value: "running" },
      { key: "bot_actual_state", value: "running" },
      { key: "bot_heartbeat_at", value: heartbeatAt },
      { key: "trading_enabled", value: "false" },
    ]);

    const res = await POST(makeRequest({ action: "restart" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(mockWithTransaction).toHaveBeenCalledTimes(1);
    expect(txQuery).toHaveBeenCalledTimes(2);
    expect(txQuery).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("INSERT INTO bot_config"),
      ["bot_desired_state", "running"]
    );
    expect(txQuery.mock.calls[1][1]?.[0]).toBe("bot_restart_token");
    expect(body.requestedAction).toBe("restart");
    expect(body.status).toEqual({
      desiredState: "running",
      actualState: "running",
      heartbeatAt,
      isResponsive: true,
      tradingEnabled: false,
    });
  });
});
