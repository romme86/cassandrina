import { NextResponse } from "next/server";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const lines: string[] = [];

  try {
    const [rounds, predictions, trades, users, balances] = await Promise.all([
      query<{ status: string; count: number }>(
        "SELECT status, COUNT(*)::int AS count FROM prediction_rounds GROUP BY status"
      ),
      query<{ paid: boolean; count: number }>(
        "SELECT paid, COUNT(*)::int AS count FROM predictions GROUP BY paid"
      ),
      query<{ status: string; count: number; total_pnl: number }>(
        `SELECT status, COUNT(*)::int AS count, COALESCE(SUM(pnl_sats), 0)::int AS total_pnl
         FROM trades GROUP BY status`
      ),
      query<{ count: number }>("SELECT COUNT(*)::int AS count FROM users"),
      query<{ total: number }>(
        "SELECT COALESCE(SUM(delta_sats), 0)::int AS total FROM balance_entries"
      ),
    ]);

    // Rounds by status
    lines.push("# HELP cassandrina_rounds_total Total prediction rounds by status");
    lines.push("# TYPE cassandrina_rounds_total gauge");
    for (const r of rounds) {
      lines.push(`cassandrina_rounds_total{status="${r.status}"} ${r.count}`);
    }

    // Predictions
    lines.push("# HELP cassandrina_predictions_total Total predictions by payment status");
    lines.push("# TYPE cassandrina_predictions_total gauge");
    for (const p of predictions) {
      lines.push(`cassandrina_predictions_total{paid="${p.paid}"} ${p.count}`);
    }

    // Trades
    lines.push("# HELP cassandrina_trades_total Total trades by status");
    lines.push("# TYPE cassandrina_trades_total gauge");
    lines.push("# HELP cassandrina_trades_pnl_sats Total PnL in sats by status");
    lines.push("# TYPE cassandrina_trades_pnl_sats gauge");
    for (const t of trades) {
      lines.push(`cassandrina_trades_total{status="${t.status}"} ${t.count}`);
      lines.push(`cassandrina_trades_pnl_sats{status="${t.status}"} ${t.total_pnl}`);
    }

    // Users
    lines.push("# HELP cassandrina_users_total Total registered users");
    lines.push("# TYPE cassandrina_users_total gauge");
    lines.push(`cassandrina_users_total ${users[0]?.count ?? 0}`);

    // Balance ledger
    lines.push("# HELP cassandrina_balance_net_sats Net balance across all users");
    lines.push("# TYPE cassandrina_balance_net_sats gauge");
    lines.push(`cassandrina_balance_net_sats ${balances[0]?.total ?? 0}`);
  } catch (err) {
    lines.push(`# Error collecting metrics: ${String(err)}`);
  }

  return new NextResponse(lines.join("\n") + "\n", {
    headers: { "Content-Type": "text/plain; version=0.0.4; charset=utf-8" },
  });
}
