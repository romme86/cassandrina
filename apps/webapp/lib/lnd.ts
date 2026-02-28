/**
 * Server-side LND invoice creation via the REST API.
 * Used by POST /api/predictions to generate Lightning invoices.
 */

export interface InvoiceResult {
  paymentRequest: string;
  rHashHex: string;
}

export async function createLndInvoice(
  amountSats: number,
  memo: string,
  expirySeconds = 3600
): Promise<InvoiceResult> {
  const host = process.env.LND_HOST;
  const port = process.env.LND_PORT ?? "8080";
  const macaroon = process.env.LND_MACAROON_HEX;

  if (!host || !macaroon) {
    throw new Error("LND_HOST and LND_MACAROON_HEX must be set");
  }

  const url = `https://${host}:${port}/v1/invoices`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Grpc-Metadata-Macaroon": macaroon,
    },
    body: JSON.stringify({ value: amountSats, memo, expiry: expirySeconds }),
    // Skip TLS verification for self-signed LND cert on Pi
    // In production you'd load the cert from LND_TLS_CERT_PATH
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LND invoice creation failed: HTTP ${res.status} — ${text}`);
  }

  const data = await res.json();
  return {
    paymentRequest: data.payment_request as string,
    rHashHex: Buffer.from(data.r_hash as string, "base64").toString("hex"),
  };
}
