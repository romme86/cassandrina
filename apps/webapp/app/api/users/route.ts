import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import type { User } from "@cassandrina/shared";

export async function GET() {
  const users = await query<User>(
    "SELECT id, whatsapp_jid, display_name, accuracy, congruency, joined_at FROM users ORDER BY accuracy DESC"
  );
  return NextResponse.json(users);
}
