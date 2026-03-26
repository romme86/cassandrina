import crypto from "node:crypto";

export function signToken(secret: string): string {
  const payload = Date.now().toString(36);
  const hmac = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  return `${payload}.${hmac}`;
}

export function verifyToken(token: string, secret: string): boolean {
  const dotIndex = token.indexOf(".");
  if (dotIndex < 0) return false;
  const payload = token.slice(0, dotIndex);
  const signature = token.slice(dotIndex + 1);
  const expected = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  if (signature.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}
