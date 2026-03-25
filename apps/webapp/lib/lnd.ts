/**
 * Server-side LND invoice creation via the REST API.
 * Used by POST /api/predictions to generate Lightning invoices.
 */
import fs from "node:fs";
import https from "node:https";

export interface InvoiceResult {
  paymentRequest: string;
  rHashHex: string;
  expiresAt: string;
}

interface HttpResponse {
  status: number;
  body: string;
}

function getLndTlsOptions(): Pick<https.RequestOptions, "ca" | "rejectUnauthorized"> {
  const certPath = process.env.LND_TLS_CERT_PATH;
  if (certPath) {
    return {
      ca: fs.readFileSync(certPath),
      rejectUnauthorized: true,
    };
  }

  // Cassandrina commonly talks to a self-signed LND endpoint on the local node.
  // Keep that working by default unless verification is explicitly forced on.
  return {
    rejectUnauthorized: process.env.LND_TLS_SKIP_VERIFY === "false",
  };
}

async function postJson(urlString: string, body: string, headers: Record<string, string>): Promise<HttpResponse> {
  const url = new URL(urlString);

  return await new Promise((resolve, reject) => {
    const req = https.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port,
        path: `${url.pathname}${url.search}`,
        method: "POST",
        headers: {
          ...headers,
          "Content-Length": Buffer.byteLength(body).toString(),
        },
        ...getLndTlsOptions(),
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        res.on("end", () => {
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      }
    );

    req.on("error", reject);
    req.write(body);
    req.end();
  });
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
  const body = JSON.stringify({ value: amountSats, memo, expiry: expirySeconds });

  const res = await postJson(url, body, {
    "Content-Type": "application/json",
    "Grpc-Metadata-Macaroon": macaroon,
  });

  if (res.status < 200 || res.status >= 300) {
    throw new Error(`LND invoice creation failed: HTTP ${res.status} — ${res.body}`);
  }

  const data = JSON.parse(res.body) as { payment_request: string; r_hash: string };
  return {
    paymentRequest: data.payment_request as string,
    rHashHex: Buffer.from(data.r_hash as string, "base64").toString("hex"),
    expiresAt: new Date(Date.now() + expirySeconds * 1000).toISOString(),
  };
}
