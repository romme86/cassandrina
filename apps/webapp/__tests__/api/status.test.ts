/** @jest-environment node */

jest.mock("@/lib/db", () => ({
  query: jest.fn(),
}));

import { query } from "@/lib/db";
import { GET as getPredictionStatus } from "@/app/api/predictions/status/route";
import { GET as getPositionStatus } from "@/app/api/position/status/route";

const mockQuery = query as jest.MockedFunction<typeof query>;

beforeEach(() => {
  jest.clearAllMocks();
  process.env.SCHEDULER_TIMEZONE = "Europe/Zurich";
});

describe("GET /api/predictions/status", () => {
  test("returns open round metadata and participant names without amounts", async () => {
    mockQuery
      .mockResolvedValueOnce([
        {
          id: 12,
          question_date: "2026-03-27",
          target_hour: 20,
          open_at: "2026-03-27T07:00:00Z",
          close_at: "2026-03-27T08:30:00Z",
          status: "open",
        },
      ])
      .mockResolvedValueOnce([
        {
          display_name: "Alice",
          paid: true,
          created_at: "2026-03-27T07:05:00Z",
          paid_at: "2026-03-27T07:06:00Z",
        },
        {
          display_name: "Bob",
          paid: false,
          created_at: "2026-03-27T07:10:00Z",
          paid_at: null,
        },
      ]);

    const res = await getPredictionStatus();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      has_round: true,
      round_id: 12,
      question_date: "2026-03-27",
      target_hour: 20,
      target_timezone: "Europe/Zurich",
      open_at: "2026-03-27T07:00:00Z",
      close_at: "2026-03-27T08:30:00Z",
      status: "open",
      participant_count: 2,
      confirmed_count: 1,
      participants: [
        {
          display_name: "Alice",
          paid: true,
          created_at: "2026-03-27T07:05:00Z",
          paid_at: "2026-03-27T07:06:00Z",
        },
        {
          display_name: "Bob",
          paid: false,
          created_at: "2026-03-27T07:10:00Z",
          paid_at: "",
        },
      ],
    });
  });

  test("returns an empty status when no rounds exist", async () => {
    mockQuery.mockResolvedValueOnce([]);

    const res = await getPredictionStatus();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.has_round).toBe(false);
    expect(body.status).toBe("none");
    expect(body.participants).toEqual([]);
  });
});

describe("GET /api/position/status", () => {
  test("returns the currently open position when one exists", async () => {
    mockQuery.mockResolvedValueOnce([
      {
        trade_id: 44,
        round_id: 12,
        question_date: "2026-03-27",
        target_hour: 20,
        strategy: "C",
        direction: "long",
        entry_price: 87123.45,
        target_price: 87000,
        leverage: 3,
        status: "open",
        pnl_sats: null,
        opened_at: "2026-03-27T08:35:00Z",
        closed_at: null,
      },
    ]);

    const res = await getPositionStatus();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.phase).toBe("open_position");
    expect(body.trade_id).toBe(44);
    expect(body.direction).toBe("long");
    expect(body.strategy).toBe("C");
  });

  test("returns prediction-window state when no position is open yet", async () => {
    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 12,
          question_date: "2026-03-27",
          target_hour: 20,
          open_at: "2026-03-27T07:00:00Z",
          close_at: "2026-03-27T08:30:00Z",
          status: "open",
        },
      ]);

    const res = await getPositionStatus();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      phase: "prediction_window_open",
      has_position: false,
      round_id: 12,
      status: "open",
      close_at: "2026-03-27T08:30:00Z",
    });
  });
});
