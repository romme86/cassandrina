import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { isAdminRequest } from "@/lib/admin";

export const dynamic = "force-dynamic";

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

function normalizeQuestionDate(questionDate: string | Date): string {
  if (questionDate instanceof Date) {
    return questionDate.toISOString().slice(0, 10);
  }
  return questionDate;
}

function hoursUntilTarget(questionDate: string | Date, targetHour: number, timeZone: string): number {
  const nowLocal = getLocalParts(new Date(), timeZone);
  const normalizedQuestionDate = normalizeQuestionDate(questionDate);
  const [targetYear, targetMonth, targetDay] = normalizedQuestionDate.split("-").map(Number);
  const nowDate = Date.UTC(nowLocal.year, nowLocal.month - 1, nowLocal.day);
  const targetDateUtc = Date.UTC(targetYear, targetMonth - 1, targetDay);
  const diffDays = Math.round((targetDateUtc - nowDate) / 86_400_000);
  return Math.max(0, diffDays * 24 + targetHour - nowLocal.hour);
}

export async function GET(request: NextRequest) {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const roundRows = await query<{
    id: number;
    question_date: string | Date;
    target_hour: number;
  }>(
    `SELECT id, question_date, target_hour
     FROM prediction_rounds
     WHERE status = 'open'
     ORDER BY open_at DESC, id DESC
     LIMIT 1`
  );

  if (roundRows.length === 0) {
    return NextResponse.json(
      { error: "No open prediction round." },
      { status: 404 }
    );
  }

  const round = roundRows[0];
  const statsRows = await query<{
    participant_count: number;
    paid_count: number;
    total_sats: number;
  }>(
    `SELECT COUNT(*)::int AS participant_count,
            SUM(CASE WHEN paid THEN 1 ELSE 0 END)::int AS paid_count,
            COALESCE(SUM(CASE WHEN paid THEN sats_amount ELSE 0 END), 0)::int AS total_sats
     FROM predictions
     WHERE round_id = $1`,
    [round.id]
  );

  const timeZone = process.env.SCHEDULER_TIMEZONE ?? "UTC";
  const stats = statsRows[0] ?? {
    participant_count: 0,
    paid_count: 0,
    total_sats: 0,
  };

  return NextResponse.json({
    round_id: round.id,
    question_date: normalizeQuestionDate(round.question_date),
    target_hour: round.target_hour,
    hours_to_target: hoursUntilTarget(round.question_date, round.target_hour, timeZone),
    participant_count: stats.participant_count ?? 0,
    paid_count: stats.paid_count ?? 0,
    total_sats: stats.total_sats ?? 0,
  });
}
