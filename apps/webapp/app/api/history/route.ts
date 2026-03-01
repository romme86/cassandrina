import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";

interface TradeHistoryRow {
  id: number;
  opened_at: string;
  closed_at: string | null;
  strategy: string;
  direction: string;
  entry_price: number;
  target_price: number;
  leverage: number;
  sats_deployed: number;
  pnl_sats: number | null;
  status: string;
  confidence_score: number | null;
}

interface HistoryStats {
  total_trades: number;
  wins: number;
  net_pnl: number;
  avg_confidence: number;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const strategy = searchParams.get("strategy") ?? "";
  const outcome = searchParams.get("outcome") ?? "";
  const from = searchParams.get("from") ?? "";
  const to = searchParams.get("to") ?? "";

  const conditions: string[] = ["status IN ('closed', 'liquidated', 'open')"];
  const params: unknown[] = [];

  if (strategy) {
    params.push(strategy);
    conditions.push(`strategy = $${params.length}`);
  }
  if (outcome === "won") {
    conditions.push("pnl_sats > 0");
  } else if (outcome === "lost") {
    conditions.push("pnl_sats <= 0");
  } else if (outcome === "liquidated") {
    conditions.push("status = 'liquidated'");
  }
  if (from) {
    params.push(from);
    conditions.push(`opened_at >= $${params.length}`);
  }
  if (to) {
    params.push(to);
    conditions.push(`opened_at <= $${params.length}`);
  }

  const where = conditions.join(" AND ");

  try {
    const [trades, statsRows] = await Promise.all([
      query<TradeHistoryRow>(
        `SELECT t.id, t.opened_at, t.closed_at, t.strategy, t.direction,
                t.entry_price, t.target_price, t.leverage, t.sats_deployed,
                t.pnl_sats, t.status,
                r.confidence_score
         FROM trades t
         LEFT JOIN prediction_rounds r ON r.question_date = t.opened_at::date
         WHERE ${where}
         ORDER BY t.opened_at DESC
         LIMIT 200`,
        params
      ),
      query<HistoryStats>(
        `SELECT COUNT(*)::int AS total_trades,
                SUM(CASE WHEN pnl_sats > 0 THEN 1 ELSE 0 END)::int AS wins,
                COALESCE(SUM(pnl_sats), 0)::int AS net_pnl,
                COALESCE(ROUND(AVG(r.confidence_score)), 0)::int AS avg_confidence
         FROM trades t
         LEFT JOIN prediction_rounds r ON r.question_date = t.opened_at::date
         WHERE ${where}`,
        params
      ),
    ]);

    return NextResponse.json({ trades, stats: statsRows[0] ?? { total_trades: 0, wins: 0, net_pnl: 0, avg_confidence: 0 } });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
