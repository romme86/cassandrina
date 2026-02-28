/**
 * Jest tests for POST /api/predictions route handler.
 * DB and LND calls are mocked.
 */

import { NextRequest } from "next/server";

// Mock dependencies before importing the route
jest.mock("@/lib/db", () => ({
  query: jest.fn(),
}));

jest.mock("@/lib/lnd", () => ({
  createLndInvoice: jest.fn(),
}));

import { POST } from "@/app/api/predictions/route";
import { query } from "@/lib/db";
import { createLndInvoice } from "@/lib/lnd";

const mockQuery = query as jest.MockedFunction<typeof query>;
const mockCreateInvoice = createLndInvoice as jest.MockedFunction<typeof createLndInvoice>;

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/predictions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("POST /api/predictions", () => {
  test("returns 422 for missing fields", async () => {
    const req = makeRequest({ whatsapp_jid: "123@s.whatsapp.net" });
    const res = await POST(req);
    expect(res.status).toBe(422);
  });

  test("returns 422 for negative price", async () => {
    const req = makeRequest({
      whatsapp_jid: "123@s.whatsapp.net",
      predicted_price: -100,
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
      whatsapp_jid: "alice@s.whatsapp.net",
      predicted_price: 95000,
      sats_amount: 500,
    });
    const res = await POST(req);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/no open/i);
  });

  test("returns 201 with lightning invoice on success", async () => {
    mockQuery
      .mockResolvedValueOnce([{ id: 1 }])    // user found
      .mockResolvedValueOnce([{ id: 42 }])   // open round
      .mockResolvedValueOnce([])              // no duplicate
      .mockResolvedValueOnce([{ id: 99 }]);  // inserted prediction

    mockCreateInvoice.mockResolvedValueOnce({
      paymentRequest: "lnbc500n1...",
      rHashHex: "deadbeef",
    });

    const req = makeRequest({
      whatsapp_jid: "alice@s.whatsapp.net",
      predicted_price: 95000,
      sats_amount: 500,
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.lightning_invoice).toBe("lnbc500n1...");
    expect(body.prediction_id).toBe(99);
  });

  test("returns 409 for duplicate prediction in same round", async () => {
    mockQuery
      .mockResolvedValueOnce([{ id: 1 }])   // user
      .mockResolvedValueOnce([{ id: 42 }])  // open round
      .mockResolvedValueOnce([{ id: 10 }]); // existing prediction

    const req = makeRequest({
      whatsapp_jid: "alice@s.whatsapp.net",
      predicted_price: 95000,
      sats_amount: 500,
    });
    const res = await POST(req);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/already submitted/i);
  });
});
