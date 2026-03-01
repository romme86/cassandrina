import { NextResponse } from "next/server";
import { query } from "@/lib/db";

export const revalidate = 30;

export async function GET() {
  try {
    const rows = await query<{
      day: string;
      daily_pnl: number;
      cumulative_pnl: number;
    }>(
      `SELECT
         DATE(opened_at) AS day,
         SUM(pnl_sats)::int AS daily_pnl,
         SUM(SUM(pnl_sats)) OVER (ORDER BY DATE(opened_at))::int AS cumulative_pnl
       FROM trades
       WHERE status IN ('closed', 'liquidated')
         AND opened_at > NOW() - INTERVAL '30 days'
       GROUP BY day
       ORDER BY day`
    );
    return NextResponse.json(rows);
  } catch {
    return NextResponse.json([], { status: 200 });
  }
}
