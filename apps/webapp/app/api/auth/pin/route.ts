import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
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

  if (body.pin !== adminPin) {
    return NextResponse.json({ error: "Incorrect PIN" }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set("cassandrina_admin", "1", {
    httpOnly: true,
    sameSite: "strict",
    maxAge: 60 * 60 * 24 * 7, // 7 days
    path: "/",
  });
  return response;
}
