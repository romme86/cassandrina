import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { platform, platform_user_id, strategy } = body as {
    platform?: string;
    platform_user_id?: string;
    strategy?: string;
  };

  if (!platform || !platform_user_id || !strategy) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 422 });
  }

  if (!["A", "B", "C", "D", "E"].includes(strategy)) {
    return NextResponse.json({ error: "Invalid strategy" }, { status: 422 });
  }

  const userRows = await query<{ id: number }>(
    "SELECT id FROM users WHERE platform = $1 AND platform_user_id = $2",
    [platform, platform_user_id]
  );
  if (userRows.length === 0) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const now = new Date();
  const dayOfWeek = (now.getDay() + 6) % 7; // Monday=0
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - dayOfWeek);
  const weekStartStr = weekStart.toISOString().split("T")[0];

  await query(
    `INSERT INTO strategy_votes (user_id, week_start, strategy)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, week_start) DO UPDATE SET strategy = EXCLUDED.strategy`,
    [userRows[0].id, weekStartStr, strategy]
  );

  return NextResponse.json({ ok: true, strategy, week_start: weekStartStr }, { status: 200 });
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const weekStart = searchParams.get("week_start");

  let dateStr: string;
  if (weekStart) {
    dateStr = weekStart;
  } else {
    const now = new Date();
    const dayOfWeek = (now.getDay() + 6) % 7;
    const ws = new Date(now);
    ws.setDate(now.getDate() - dayOfWeek);
    dateStr = ws.toISOString().split("T")[0];
  }

  const results = await query<{ strategy: string; votes: number }>(
    `SELECT strategy, COUNT(*)::int AS votes
     FROM strategy_votes WHERE week_start = $1
     GROUP BY strategy ORDER BY votes DESC`,
    [dateStr]
  );

  return NextResponse.json({ week_start: dateStr, results });
}
