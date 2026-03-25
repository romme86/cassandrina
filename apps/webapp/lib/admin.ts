import { NextRequest } from "next/server";

const ADMIN_SECRET_HEADER = "x-cassandrina-admin-secret";

export function isAdminRequest(request: NextRequest): boolean {
  if (request.cookies.get("cassandrina_admin")?.value === "1") {
    return true;
  }

  const configuredSecret = process.env.INTERNAL_API_SECRET;
  if (!configuredSecret) {
    return false;
  }

  return request.headers.get(ADMIN_SECRET_HEADER) === configuredSecret;
}

export function getAdminSecretHeaderName(): string {
  return ADMIN_SECRET_HEADER;
}
