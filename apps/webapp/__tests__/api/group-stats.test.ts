/** @jest-environment node */

import { NextRequest } from "next/server";

jest.mock("@/lib/db", () => ({
  query: jest.fn(),
}));

import { query } from "@/lib/db";
import { GET as getGroupStats } from "@/app/api/admin/stats/groups/route";

const mockQuery = query as jest.MockedFunction<typeof query>;

describe("GET /api/admin/stats/groups", () => {
  const originalSecret = process.env.INTERNAL_API_SECRET;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.INTERNAL_API_SECRET = "super-secret";
  });

  afterAll(() => {
    process.env.INTERNAL_API_SECRET = originalSecret;
  });

  test("returns 401 without admin auth", async () => {
    const req = new NextRequest("http://localhost/api/admin/stats/groups");

    const res = await getGroupStats(req);
    expect(res.status).toBe(401);
  });

  test("returns aggregated group stats", async () => {
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
    expect(body).toEqual([
      expect.objectContaining({
        group_name: "Friends of BTC",
        telegram_group_chat_id: "-100123",
        participant_count: 3,
        balance_sats: 1234,
      }),
    ]);
  });
});
