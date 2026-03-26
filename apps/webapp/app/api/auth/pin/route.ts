import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { signToken } from "@/lib/auth-token";

export const dynamic = "force-dynamic";

const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_ATTEMPTS = 5;
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function checkPinRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);

  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (entry.count >= MAX_ATTEMPTS) return false;
  entry.count++;
  return true;
}

export async function POST(request: NextRequest) {
  const clientIp = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";

  if (!checkPinRateLimit(clientIp)) {
    return NextResponse.json(
      { error: "Too many attempts. Try again later." },
      { status: 429 }
    );
  }

  let body: { pin?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const adminPin = process.env.ADMIN_PIN;
  if (!adminPin) {
    return NextResponse.json({ error: "ADMIN_PIN not configured" }, { status: 500 });
  }

  const pinInput = body.pin ?? "";
  if (
    pinInput.length !== adminPin.length ||
    !crypto.timingSafeEqual(Buffer.from(pinInput), Buffer.from(adminPin))
  ) {
    return NextResponse.json({ error: "Incorrect PIN" }, { status: 401 });
  }

  const cookieSecret = process.env.NEXTAUTH_SECRET ?? process.env.INTERNAL_API_SECRET;
  if (!cookieSecret) {
    return NextResponse.json({ error: "Server signing secret not configured" }, { status: 500 });
  }

  const token = signToken(cookieSecret);
  const response = NextResponse.json({ ok: true });
  response.cookies.set("cassandrina_admin", token, {
    httpOnly: true,
    sameSite: "strict",
    maxAge: 60 * 60 * 24 * 7, // 7 days
    path: "/",
  });
  return response;
}
