/** @jest-environment node */

import { NextRequest } from "next/server";

jest.mock("@/lib/db", () => ({
  query: jest.fn(),
}));

jest.mock("@/lib/redis", () => ({
  getRedis: jest.fn(() => ({
    publish: jest.fn().mockResolvedValue(1),
  })),
}));

import { query } from "@/lib/db";
import { getRedis } from "@/lib/redis";
import { POST as startPrediction } from "@/app/api/admin/predictions/start/route";
import { GET as getBalanceStats } from "@/app/api/admin/stats/balance/route";
import { GET as getGroupStats } from "@/app/api/admin/stats/groups/route";
import { GET as getUserStats } from "@/app/api/admin/stats/users/route";
import { GET as getInternalUserStats } from "@/app/api/internal/users/stats/route";

const mockQuery = query as jest.MockedFunction<typeof query>;
const mockGetRedis = getRedis as jest.MockedFunction<typeof getRedis>;

describe("admin API routes", () => {
  const originalSecret = process.env.INTERNAL_API_SECRET;
  const originalTimeZone = process.env.SCHEDULER_TIMEZONE;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.INTERNAL_API_SECRET = "super-secret";
    process.env.SCHEDULER_TIMEZONE = "UTC";
  });

  afterAll(() => {
    process.env.INTERNAL_API_SECRET = originalSecret;
    process.env.SCHEDULER_TIMEZONE = originalTimeZone;
  });

  test("POST /api/admin/predictions/start returns 401 without admin auth", async () => {
    const req = new NextRequest("http://localhost/api/admin/predictions/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ minutes: 30 }),
    });

    const res = await startPrediction(req);
    expect(res.status).toBe(401);
  });

  test("POST /api/admin/predictions/start publishes a new round", async () => {
    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { key: "prediction_target_hour", value: "16" },
        { key: "min_sats", value: "100" },
        { key: "max_sats", value: "5000" },
      ])
      .mockResolvedValueOnce([
        {
          id: 42,
          question_date: "2026-03-25",
          target_hour: 16,
          open_at: "2026-03-25T12:00:00.000Z",
          close_at: "2026-03-25T12:30:00.000Z",
          status: "open",
        },
      ]);

    const req = new NextRequest("http://localhost/api/admin/predictions/start", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-cassandrina-admin-secret": "super-secret",
      },
      body: JSON.stringify({ minutes: 30 }),
    });

    const res = await startPrediction(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.round_id).toBe(42);

    const redis = mockGetRedis.mock.results[0]?.value;
    expect(redis.publish).toHaveBeenCalledTimes(1);
  });

  test("POST /api/admin/predictions/start overwrites an existing open round", async () => {
    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 7,
          question_date: "2026-03-25",
          target_hour: 16,
          open_at: "2026-03-25T08:00:00.000Z",
          close_at: "2026-03-25T14:00:00.000Z",
          status: "open",
        },
      ])
      .mockResolvedValueOnce([
        { key: "prediction_target_hour", value: "16" },
        { key: "min_sats", value: "100" },
        { key: "max_sats", value: "5000" },
      ])
      .mockResolvedValueOnce([
        { participant_count: 2, paid_count: 1, total_sats: 700 },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 42,
          question_date: "2026-03-25",
          target_hour: 16,
          open_at: "2026-03-25T12:00:00.000Z",
          close_at: "2026-03-25T12:05:00.000Z",
          status: "open",
        },
      ]);

    const req = new NextRequest("http://localhost/api/admin/predictions/start", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-cassandrina-admin-secret": "super-secret",
      },
      body: JSON.stringify({ minutes: 5 }),
    });

    const res = await startPrediction(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.round_id).toBe(42);
    expect(body.replaced_round_id).toBe(7);

    expect(mockQuery).toHaveBeenNthCalledWith(
      4,
      expect.stringContaining("WHERE round_id = $1"),
      [7]
    );
    expect(mockQuery).toHaveBeenNthCalledWith(
      5,
      expect.stringContaining("SET status = 'settled'"),
      [expect.any(String)]
    );

    const redis = mockGetRedis.mock.results[0]?.value;
    expect(redis.publish).toHaveBeenCalledTimes(2);
    expect(redis.publish).toHaveBeenNthCalledWith(
      1,
      "cassandrina:prediction:close",
      expect.stringContaining("\"close_reason\":\"admin_override\"")
    );
    expect(redis.publish).toHaveBeenNthCalledWith(
      2,
      "cassandrina:prediction:open",
      expect.stringContaining("\"round_id\":42")
    );
  });

  test("POST /api/admin/predictions/start drops the legacy one-round-per-day constraint", async () => {
    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { key: "prediction_target_hour", value: "16" },
        { key: "min_sats", value: "100" },
        { key: "max_sats", value: "5000" },
      ])
      .mockResolvedValueOnce([
        {
          id: 42,
          question_date: "2026-03-25",
          target_hour: 16,
          open_at: "2026-03-25T12:00:00.000Z",
          close_at: "2026-03-25T12:05:00.000Z",
          status: "open",
        },
      ]);

    const req = new NextRequest("http://localhost/api/admin/predictions/start", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-cassandrina-admin-secret": "super-secret",
      },
      body: JSON.stringify({ minutes: 5 }),
    });

    const res = await startPrediction(req);
    expect(res.status).toBe(200);
    expect(mockQuery).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("DROP CONSTRAINT prediction_rounds_question_date_key")
    );
  });

  test("GET /api/admin/stats/balance returns open-round stats", async () => {
    mockQuery
      .mockResolvedValueOnce([{ id: 42, question_date: "2026-03-25", target_hour: 16 }])
      .mockResolvedValueOnce([{ participant_count: 3, paid_count: 2, total_sats: 1500 }]);

    const req = new NextRequest("http://localhost/api/admin/stats/balance", {
      headers: {
        "x-cassandrina-admin-secret": "super-secret",
      },
    });

    const res = await getBalanceStats(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.round_id).toBe(42);
    expect(body.participant_count).toBe(3);
    expect(body.paid_count).toBe(2);
    expect(body.total_sats).toBe(1500);
  });

  test("GET /api/admin/stats/users returns aggregated user stats", async () => {
    mockQuery.mockResolvedValueOnce([
      {
        id: 1,
        display_name: "Alice",
        accuracy: 0.615,
        congruency: 0.522,
        balance_sats: 1234,
        profit_sats: 234,
        total_predictions: 7,
      },
    ]);

    const req = new NextRequest("http://localhost/api/admin/stats/users", {
      headers: {
        "x-cassandrina-admin-secret": "super-secret",
      },
    });

    const res = await getUserStats(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body[0].display_name).toBe("Alice");
    expect(body[0].balance_sats).toBe(1234);
  });

  test("GET /api/admin/stats/groups returns aggregated group stats", async () => {
    mockQuery.mockResolvedValueOnce([
      {
        group_name: "Friends of BTC",
        telegram_group_chat_id: "-100123",
        average_accuracy: 0.615,
        average_congruency: 0.522,
        balance_sats: 1234,
        profit_sats: 234,
        total_predictions: 7,
        participant_count: 3,
      },
    ]);

    const req = new NextRequest("http://localhost/api/admin/stats/groups", {
      headers: {
        "x-cassandrina-admin-secret": "super-secret",
      },
    });

    const res = await getGroupStats(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body[0].group_name).toBe("Friends of BTC");
    expect(body[0].participant_count).toBe(3);
    expect(body[0].balance_sats).toBe(1234);
  });

  test("GET /api/internal/users/stats returns one user's stats by platform identity", async () => {
    mockQuery.mockResolvedValueOnce([
      {
        user_id: 42,
        display_name: "Alice",
        platform_user_id: "123",
        accuracy: 0.615,
        congruency: 0.522,
        balance_sats: 1234,
        profit_sats: 234,
        total_predictions: 7,
      },
    ]);

    const req = new NextRequest(
      "http://localhost/api/internal/users/stats?platform=telegram&platform_user_id=123",
      {
        headers: {
          "x-cassandrina-admin-secret": "super-secret",
        },
      }
    );

    const res = await getInternalUserStats(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user_id).toBe(42);
    expect(body.platform_user_id).toBe("123");
    expect(body.total_predictions).toBe(7);
  });

  test("GET /api/internal/users/stats returns default stats for unknown users", async () => {
    mockQuery.mockResolvedValueOnce([]);

    const req = new NextRequest(
      "http://localhost/api/internal/users/stats?platform=telegram&platform_user_id=555",
      {
        headers: {
          "x-cassandrina-admin-secret": "super-secret",
        },
      }
    );

    const res = await getInternalUserStats(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user_id).toBeNull();
    expect(body.platform_user_id).toBe("555");
    expect(body.total_predictions).toBe(0);
    expect(body.accuracy).toBe(0.5);
    expect(body.congruency).toBe(0.5);
  });
});
