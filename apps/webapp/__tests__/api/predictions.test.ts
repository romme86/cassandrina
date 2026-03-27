/** @jest-environment node */
/**
 * Jest tests for POST /api/predictions route handler.
 * DB and LND calls are mocked.
 */

import { NextRequest } from "next/server";

// Mock dependencies before importing the route
jest.mock("@/lib/db", () => ({
  query: jest.fn(),
  withTransaction: jest.fn(),
}));

jest.mock("@/lib/lnd", () => ({
  createLndInvoice: jest.fn(),
}));

jest.mock("@/lib/redis", () => ({
  getRedis: jest.fn(() => ({
    incr: jest.fn().mockResolvedValue(1),
    expire: jest.fn().mockResolvedValue(1),
  })),
}));

jest.mock("@cassandrina/shared", () => ({
  CreatePredictionSchema: {
    safeParse(input: any) {
      if (
        !input ||
        typeof input.platform !== "string" ||
        input.platform.length === 0 ||
        typeof input.platform_user_id !== "string" ||
        input.platform_user_id.length === 0 ||
        typeof input.predicted_low_price !== "number" ||
        input.predicted_low_price <= 0 ||
        typeof input.predicted_high_price !== "number" ||
        input.predicted_high_price < input.predicted_low_price ||
        typeof input.sats_amount !== "number" ||
        input.sats_amount <= 0
      ) {
        return {
          success: false,
          error: { flatten: () => ({ fieldErrors: {} }) },
        };
      }
      return { success: true, data: input };
    },
  },
}));

import { POST } from "@/app/api/predictions/route";
import { query, withTransaction } from "@/lib/db";
import { createLndInvoice } from "@/lib/lnd";

const mockQuery = query as jest.MockedFunction<typeof query>;
const mockWithTransaction = withTransaction as jest.MockedFunction<typeof withTransaction>;
const mockCreateInvoice = createLndInvoice as jest.MockedFunction<typeof createLndInvoice>;

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/predictions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mockQuery.mockReset();
  mockCreateInvoice.mockReset();
  mockWithTransaction.mockReset();
  mockWithTransaction.mockImplementation(async (callback) => {
    const client = {
      query: jest.fn().mockImplementation(async (sql: string) => {
        if (sql.includes("SELECT id FROM predictions")) {
          return { rows: [] };
        }
        if (sql.includes("INSERT INTO predictions")) {
          return { rows: [{ id: 99 }] };
        }
        return { rows: [] };
      }),
    };
    return callback(client as never);
  });
});

describe("POST /api/predictions", () => {
  test("returns 422 for missing fields", async () => {
    const req = makeRequest({ platform: "telegram", platform_user_id: "12345" });
    const res = await POST(req);
    expect(res.status).toBe(422);
  });

  test("returns 422 for negative price", async () => {
    const req = makeRequest({
      platform: "telegram",
      platform_user_id: "12345",
      predicted_low_price: -100,
      predicted_high_price: 100,
      sats_amount: 500,
    });
    const res = await POST(req);
    expect(res.status).toBe(422);
  });

  test("returns 409 when no open round", async () => {
    mockQuery
      .mockResolvedValueOnce([{ id: 1 }])   // user exists
      .mockResolvedValueOnce([]);             // no open round

    const req = makeRequest({
      platform: "telegram",
      platform_user_id: "2001",
      display_name: "alice",
      predicted_low_price: 94000,
      predicted_high_price: 96000,
      sats_amount: 500,
    });
    const res = await POST(req);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/no open/i);
  });

  test("returns 201 with lightning invoice on success", async () => {
    let insertArgs: unknown[] | undefined;

    mockQuery
      .mockResolvedValueOnce([{ id: 1 }])    // user found
      .mockResolvedValueOnce([{ id: 42 }])   // open round
      .mockResolvedValueOnce([])              // no duplicate
      .mockResolvedValueOnce([{ id: 99 }]);  // inserted prediction

    mockCreateInvoice.mockResolvedValueOnce({
      paymentRequest: "lnbc500n1...",
      rHashHex: "deadbeef",
      expiresAt: "2026-03-20T10:00:00.000Z",
    });

    mockWithTransaction.mockImplementationOnce(async (callback) => {
      const client = {
        query: jest.fn().mockImplementation(async (sql: string, params?: unknown[]) => {
          if (sql.includes("SELECT id FROM predictions")) {
            return { rows: [] };
          }
          if (sql.includes("INSERT INTO predictions")) {
            insertArgs = params;
            return { rows: [{ id: 99 }] };
          }
          return { rows: [] };
        }),
      };
      return callback(client as never);
    });

    const req = makeRequest({
      platform: "telegram",
      platform_user_id: "2002",
      display_name: "alice",
      telegram_group_chat_id: "-100123",
      telegram_group_name: "Friends of BTC",
      predicted_low_price: 94000,
      predicted_high_price: 96000,
      sats_amount: 500,
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.lightning_invoice).toBe("lnbc500n1...");
    expect(body.prediction_id).toBe(99);
    expect(mockWithTransaction).toHaveBeenCalled();
    expect(insertArgs?.[2]).toBe("-100123");
    expect(insertArgs?.[3]).toBe("Friends of BTC");
  });

  test("returns 503 when lightning invoice creation fails", async () => {
    mockQuery
      .mockResolvedValueOnce([{ id: 1 }])   // user found
      .mockResolvedValueOnce([{ id: 42 }])  // open round
      .mockResolvedValueOnce([]);           // no duplicate

    mockCreateInvoice.mockRejectedValueOnce(new Error("self-signed certificate"));

    const req = makeRequest({
      platform: "telegram",
      platform_user_id: "2003",
      display_name: "alice",
      predicted_low_price: 94000,
      predicted_high_price: 96000,
      sats_amount: 500,
    });
    const res = await POST(req);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toMatch(/invoice creation is unavailable/i);
    expect(mockWithTransaction).not.toHaveBeenCalled();
  });

  test("returns 409 for duplicate prediction in same round", async () => {
    mockQuery
      .mockResolvedValueOnce([{ id: 1 }])   // user
      .mockResolvedValueOnce([{ id: 42 }]); // open round

    mockCreateInvoice.mockResolvedValueOnce({
      paymentRequest: "lnbc500n1...",
      rHashHex: "deadbeef",
      expiresAt: "2026-03-20T10:00:00.000Z",
    });

    mockWithTransaction.mockImplementationOnce(async (callback) => {
      const client = {
        query: jest.fn().mockImplementation(async (sql: string) => {
          if (sql.includes("SELECT id FROM predictions")) {
            return { rows: [{ id: 10 }] };
          }
          return { rows: [] };
        }),
      };
      return callback(client as never);
    });

    const req = makeRequest({
      platform: "telegram",
      platform_user_id: "1001",
      display_name: "alice",
      predicted_low_price: 94000,
      predicted_high_price: 96000,
      sats_amount: 500,
    });
    const res = await POST(req);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/already submitted/i);
  });
});
