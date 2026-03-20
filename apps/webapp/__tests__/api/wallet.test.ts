/** @jest-environment node */
jest.mock("@/lib/db", () => ({
  query: jest.fn(),
}));

import { GET } from "@/app/api/wallet/route";
import { query } from "@/lib/db";

const mockQuery = query as jest.MockedFunction<typeof query>;

describe("GET /api/wallet", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.LND_HOST;
    delete process.env.LND_MACAROON_HEX;
  });

  test("returns invoice and trade activity", async () => {
    mockQuery
      .mockResolvedValueOnce([
        {
          payment_hash: "deadbeef",
          memo: "Cassandrina prediction - round 1",
          amount_sats: 500,
          paid: true,
          created_at: "2026-03-20T08:00:00.000Z",
          invoice: "lnbc500n1...",
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 1,
          pnl_sats: 100,
          strategy: "A",
          direction: "long",
          opened_at: "2026-03-20T09:00:00.000Z",
          status: "closed",
        },
      ]);

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.transactions).toHaveLength(2);
    expect(body.transactions[0].type).toBeDefined();
  });
});
