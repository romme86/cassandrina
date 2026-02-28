/**
 * Jest tests for GET/POST /api/config route handlers.
 */

import { NextRequest } from "next/server";

jest.mock("@/lib/db", () => ({
  query: jest.fn(),
}));

import { GET, POST } from "@/app/api/config/route";
import { query } from "@/lib/db";

const mockQuery = query as jest.MockedFunction<typeof query>;

beforeEach(() => jest.clearAllMocks());

describe("GET /api/config", () => {
  test("returns config as key-value object", async () => {
    mockQuery.mockResolvedValueOnce([
      { key: "min_sats", value: "100" },
      { key: "max_sats", value: "5000" },
    ]);

    const res = await GET();
    const body = await res.json();
    expect(body.min_sats).toBe("100");
    expect(body.max_sats).toBe("5000");
  });
});

describe("POST /api/config", () => {
  function makeRequest(body: unknown) {
    return new NextRequest("http://localhost/api/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  test("returns 422 for invalid values", async () => {
    const req = makeRequest({ prediction_target_hour: 99 });
    const res = await POST(req);
    expect(res.status).toBe(422);
  });

  test("updates valid fields and returns updated keys", async () => {
    mockQuery.mockResolvedValue([]);

    const req = makeRequest({ min_sats: 200, max_sats: 3000 });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.updated).toContain("min_sats");
    expect(body.updated).toContain("max_sats");
  });
});
