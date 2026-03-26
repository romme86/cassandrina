import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { isAdminRequest } from "@/lib/admin";
import { getRedis } from "@/lib/redis";

export const dynamic = "force-dynamic";

interface RoundSummary {
  id: number;
  question_date: string;
  target_hour: number;
  open_at: string;
  close_at: string | null;
  status: string;
}

interface RoundStats {
  participant_count: number;
  paid_count: number;
  total_sats: number;
}

function getLocalParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
  };
}

function addDays(dateString: string, days: number): string {
  const [year, month, day] = dateString.split("-").map(Number);
  const result = new Date(Date.UTC(year, month - 1, day + days));
  return result.toISOString().slice(0, 10);
}

function getQuestionDate(now: Date, targetHour: number, timeZone: string): string {
  const local = getLocalParts(now, timeZone);
  const currentDate = `${local.year.toString().padStart(4, "0")}-${local.month
    .toString()
    .padStart(2, "0")}-${local.day.toString().padStart(2, "0")}`;

  if (local.hour < targetHour) {
    return currentDate;
  }

  return addDays(currentDate, 1);
}

export async function POST(request: NextRequest) {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const minutes = Number((body as { minutes?: unknown })?.minutes);
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 720) {
    return NextResponse.json(
      { error: "Minutes must be an integer between 1 and 720." },
      { status: 422 }
    );
  }

  const [openRounds, configRows] = await Promise.all([
    query<RoundSummary>(
      `SELECT id, question_date, target_hour, open_at, close_at, status
       FROM prediction_rounds
       WHERE status = 'open'
       ORDER BY open_at DESC, id DESC`
    ),
    query<{ key: string; value: string }>("SELECT key, value FROM bot_config"),
  ]);

  const config = Object.fromEntries(configRows.map((row) => [row.key, row.value]));
  const targetHour = Number(config.prediction_target_hour ?? "19");
  const minSats = Number(config.min_sats ?? "100");
  const maxSats = Number(config.max_sats ?? "5000");
  const timeZone = process.env.SCHEDULER_TIMEZONE ?? "Europe/Zurich";

  const now = new Date();
  const openAt = now.toISOString();
  const closeAt = new Date(now.getTime() + minutes * 60_000).toISOString();
  const questionDate = getQuestionDate(now, targetHour, timeZone);
  const replacedRound = openRounds[0] ?? null;

  let replacedRoundStats: RoundStats | null = null;
  if (replacedRound) {
    const statsRows = await query<RoundStats>(
      `SELECT COUNT(*)::int AS participant_count,
              SUM(CASE WHEN paid THEN 1 ELSE 0 END)::int AS paid_count,
              COALESCE(SUM(CASE WHEN paid THEN sats_amount ELSE 0 END), 0)::int AS total_sats
       FROM predictions
       WHERE round_id = $1`,
      [replacedRound.id]
    );
    replacedRoundStats = statsRows[0] ?? {
      participant_count: 0,
      paid_count: 0,
      total_sats: 0,
    };

    // Retire any currently-open round so a manual override becomes the only active round.
    await query(
      `UPDATE prediction_rounds
       SET status = 'settled', close_at = $1
       WHERE status = 'open'`,
      [openAt]
    );
  }

  const roundRows = await query<RoundSummary>(
    `INSERT INTO prediction_rounds (question_date, target_hour, open_at, close_at, status)
     VALUES ($1, $2, $3, $4, 'open')
     RETURNING id, question_date, target_hour, open_at, close_at, status`,
    [questionDate, targetHour, openAt, closeAt]
  );

  const round = roundRows[0];
  const redis = getRedis();

  if (replacedRound) {
    await redis.publish(
      "cassandrina:prediction:close",
      JSON.stringify({
        round_id: replacedRound.id,
        participant_count: replacedRoundStats?.participant_count ?? 0,
        paid_count: replacedRoundStats?.paid_count ?? 0,
        total_sats: replacedRoundStats?.total_sats ?? 0,
        close_reason: "admin_override",
      })
    );
  }

  await redis.publish(
    "cassandrina:prediction:open",
    JSON.stringify({
      round_id: round.id,
      question_date: round.question_date,
      target_hour: round.target_hour,
      target_timezone: timeZone,
      min_sats: minSats,
      max_sats: maxSats,
      close_at: round.close_at,
    })
  );

  return NextResponse.json({
    round_id: round.id,
    question_date: round.question_date,
    target_hour: round.target_hour,
    target_timezone: timeZone,
    close_at: round.close_at,
    minutes,
    replaced_round_id: replacedRound?.id ?? null,
  });
}
