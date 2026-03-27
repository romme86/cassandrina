import { NextResponse } from "next/server";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

interface RoundRow {
  id: number;
  question_date: string | Date;
  target_hour: number;
  open_at: string;
  close_at: string | null;
  status: "open" | "closed" | "settled";
}

interface ParticipantRow {
  display_name: string;
  paid: boolean;
  created_at: string;
  paid_at: string | null;
}

function normalizeQuestionDate(questionDate: string | Date): string {
  if (questionDate instanceof Date) {
    return questionDate.toISOString().slice(0, 10);
  }
  return questionDate;
}

export async function GET() {
  const roundRows = await query<RoundRow>(
    `SELECT id, question_date, target_hour, open_at, close_at, status
     FROM prediction_rounds
     ORDER BY (status = 'open') DESC, open_at DESC, id DESC
     LIMIT 1`
  );

  const targetTimeZone = process.env.SCHEDULER_TIMEZONE ?? "UTC";

  if (roundRows.length === 0) {
    return NextResponse.json({
      has_round: false,
      round_id: null,
      question_date: "",
      target_hour: 0,
      target_timezone: targetTimeZone,
      open_at: "",
      close_at: "",
      status: "none",
      participant_count: 0,
      confirmed_count: 0,
      participants: [],
    });
  }

  const round = roundRows[0];
  const participants = await query<ParticipantRow>(
    `SELECT u.display_name, p.paid, p.created_at, p.paid_at
     FROM predictions p
     JOIN users u ON u.id = p.user_id
     WHERE p.round_id = $1
     ORDER BY p.paid DESC, p.created_at ASC, p.id ASC`,
    [round.id]
  );

  return NextResponse.json({
    has_round: true,
    round_id: round.id,
    question_date: normalizeQuestionDate(round.question_date),
    target_hour: round.target_hour,
    target_timezone: targetTimeZone,
    open_at: round.open_at,
    close_at: round.close_at ?? "",
    status: round.status,
    participant_count: participants.length,
    confirmed_count: participants.filter((participant) => participant.paid).length,
    participants: participants.map((participant) => ({
      display_name: participant.display_name,
      paid: participant.paid,
      created_at: participant.created_at,
      paid_at: participant.paid_at ?? "",
    })),
  });
}
