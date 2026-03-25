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
        accuracy: 61.5,
        congruency: 52.2,
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

  test("GET /api/internal/users/stats returns one user's stats by platform identity", async () => {
    mockQuery.mockResolvedValueOnce([
      {
        user_id: 42,
        display_name: "Alice",
        platform_user_id: "123",
        accuracy: 61.5,
        congruency: 52.2,
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
});
