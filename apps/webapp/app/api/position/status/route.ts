import { NextResponse } from "next/server";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

interface TradeRow {
  trade_id: number;
  round_id: number;
  question_date: string | Date;
  target_hour: number;
  strategy: string;
  direction: "long" | "short";
  entry_price: number;
  target_price: number;
  leverage: number;
  status: "open" | "closed" | "liquidated";
  pnl_sats: number | null;
  opened_at: string;
  closed_at: string | null;
}

interface RoundRow {
  id: number;
  question_date: string | Date;
  target_hour: number;
  open_at: string;
  close_at: string | null;
  status: "open" | "closed" | "settled";
}

function normalizeQuestionDate(questionDate: string | Date): string {
  if (questionDate instanceof Date) {
    return questionDate.toISOString().slice(0, 10);
  }
  return questionDate;
}

function formatTradePayload(
  phase: "open_position" | "last_position",
  trade: TradeRow,
  targetTimeZone: string
) {
  return {
    phase,
    has_position: true,
    trade_id: trade.trade_id,
    round_id: trade.round_id,
    question_date: normalizeQuestionDate(trade.question_date),
    target_hour: trade.target_hour,
    target_timezone: targetTimeZone,
    open_at: "",
    close_at: "",
    status: trade.status,
    strategy: trade.strategy,
    direction: trade.direction,
    entry_price: trade.entry_price,
    target_price: trade.target_price,
    leverage: trade.leverage,
    opened_at: trade.opened_at,
    closed_at: trade.closed_at ?? "",
    pnl_sats: trade.pnl_sats,
  };
}

export async function GET() {
  const targetTimeZone = process.env.SCHEDULER_TIMEZONE ?? "UTC";

  const openTrades = await query<TradeRow>(
    `SELECT t.id AS trade_id, t.round_id, r.question_date, r.target_hour,
            t.strategy, t.direction, t.entry_price, t.target_price, t.leverage,
            t.status, t.pnl_sats, t.opened_at, t.closed_at
     FROM trades t
     JOIN prediction_rounds r ON r.id = t.round_id
     WHERE t.status = 'open'
     ORDER BY t.opened_at DESC, t.id DESC
     LIMIT 1`
  );

  if (openTrades.length > 0) {
    return NextResponse.json(formatTradePayload("open_position", openTrades[0], targetTimeZone));
  }

  const openRounds = await query<RoundRow>(
    `SELECT id, question_date, target_hour, open_at, close_at, status
     FROM prediction_rounds
     WHERE status = 'open'
     ORDER BY open_at DESC, id DESC
     LIMIT 1`
  );

  if (openRounds.length > 0) {
    const round = openRounds[0];
    return NextResponse.json({
      phase: "prediction_window_open",
      has_position: false,
      trade_id: null,
      round_id: round.id,
      question_date: normalizeQuestionDate(round.question_date),
      target_hour: round.target_hour,
      target_timezone: targetTimeZone,
      open_at: round.open_at,
      close_at: round.close_at ?? "",
      status: round.status,
      strategy: "",
      direction: "",
      entry_price: 0,
      target_price: 0,
      leverage: 0,
      opened_at: "",
      closed_at: "",
      pnl_sats: null,
    });
  }

  const lastTrades = await query<TradeRow>(
    `SELECT t.id AS trade_id, t.round_id, r.question_date, r.target_hour,
            t.strategy, t.direction, t.entry_price, t.target_price, t.leverage,
            t.status, t.pnl_sats, t.opened_at, t.closed_at
     FROM trades t
     JOIN prediction_rounds r ON r.id = t.round_id
     ORDER BY t.opened_at DESC, t.id DESC
     LIMIT 1`
  );

  if (lastTrades.length > 0) {
    return NextResponse.json(formatTradePayload("last_position", lastTrades[0], targetTimeZone));
  }

  const lastRounds = await query<RoundRow>(
    `SELECT id, question_date, target_hour, open_at, close_at, status
     FROM prediction_rounds
     ORDER BY open_at DESC, id DESC
     LIMIT 1`
  );

  if (lastRounds.length > 0) {
    const round = lastRounds[0];
    return NextResponse.json({
      phase: "awaiting_position",
      has_position: false,
      trade_id: null,
      round_id: round.id,
      question_date: normalizeQuestionDate(round.question_date),
      target_hour: round.target_hour,
      target_timezone: targetTimeZone,
      open_at: round.open_at,
      close_at: round.close_at ?? "",
      status: round.status,
      strategy: "",
      direction: "",
      entry_price: 0,
      target_price: 0,
      leverage: 0,
      opened_at: "",
      closed_at: "",
      pnl_sats: null,
    });
  }

  return NextResponse.json({
    phase: "idle",
    has_position: false,
    trade_id: null,
    round_id: null,
    question_date: "",
    target_hour: 0,
    target_timezone: targetTimeZone,
    open_at: "",
    close_at: "",
    status: "none",
    strategy: "",
    direction: "",
    entry_price: 0,
    target_price: 0,
    leverage: 0,
    opened_at: "",
    closed_at: "",
    pnl_sats: null,
  });
}
