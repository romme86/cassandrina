import { NextResponse } from "next/server";
import { query } from "@/lib/db";

export const revalidate = 30;

export async function GET() {
  try {
    const rows = await query<{
      strategy: string;
      total_trades: number;
      wins: number;
      avg_pnl_sats: number;
      total_pnl_sats: number;
    }>(
      `SELECT
         strategy,
         COUNT(*)::int AS total_trades,
         SUM(CASE WHEN pnl_sats > 0 THEN 1 ELSE 0 END)::int AS wins,
         ROUND(AVG(pnl_sats))::int AS avg_pnl_sats,
         SUM(pnl_sats)::int AS total_pnl_sats
       FROM trades
       WHERE status IN ('closed', 'liquidated')
       GROUP BY strategy
       ORDER BY strategy`
    );
    return NextResponse.json(rows);
  } catch {
    return NextResponse.json([], { status: 200 });
  }
}
