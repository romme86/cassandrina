import crypto from "node:crypto";
import { NextRequest } from "next/server";
import { verifyToken } from "@/lib/auth-token";

const ADMIN_SECRET_HEADER = "x-cassandrina-admin-secret";

function timingSafeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export function isAdminRequest(request: NextRequest): boolean {
  const cookieValue = request.cookies.get("cassandrina_admin")?.value;
  if (cookieValue) {
    const cookieSecret = process.env.NEXTAUTH_SECRET ?? process.env.INTERNAL_API_SECRET;
    if (cookieSecret && verifyToken(cookieValue, cookieSecret)) {
      return true;
    }
  }

  const configuredSecret = process.env.INTERNAL_API_SECRET;
  if (!configuredSecret) {
    return false;
  }

  const headerValue = request.headers.get(ADMIN_SECRET_HEADER);
  if (!headerValue) return false;

  return timingSafeEquals(headerValue, configuredSecret);
}

export function getAdminSecretHeaderName(): string {
  return ADMIN_SECRET_HEADER;
}
