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
  if (process.env.LND_TLS_SKIP_VERIFY === "true") {
    return {
      rejectUnauthorized: false,
    };
  }

  const certPath = process.env.LND_TLS_CERT_PATH;
  if (certPath) {
    return {
      ca: fs.readFileSync(certPath),
      rejectUnauthorized: true,
    };
  }

  // Without an explicit cert path, default to verifying TLS.
  return {
    rejectUnauthorized: true,
  };
}

async function requestJson(
  urlString: string,
  method: "GET" | "POST",
  headers: Record<string, string>,
  body?: string
): Promise<HttpResponse> {
  const url = new URL(urlString);

  return await new Promise((resolve, reject) => {
    const req = https.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port,
        path: `${url.pathname}${url.search}`,
        method,
        headers,
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
    if (body) {
      req.write(body);
    }
    req.end();
  });
}

export interface PaymentResult {
  paymentHash: string;
  feeSats: number;
}

export async function payLndInvoice(paymentRequest: string): Promise<PaymentResult> {
  const host = process.env.LND_HOST;
  const port = process.env.LND_PORT ?? "8080";
  const macaroon = process.env.LND_MACAROON_HEX;

  if (!host || !macaroon) {
    throw new Error("LND_HOST and LND_MACAROON_HEX must be set");
  }

  const url = `https://${host}:${port}/v1/channels/transactions`;
  const body = JSON.stringify({ payment_request: paymentRequest });

  const res = await requestJson(url, "POST", {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body).toString(),
    "Grpc-Metadata-Macaroon": macaroon,
  }, body);

  if (res.status < 200 || res.status >= 300) {
    throw new Error(`LND payment failed: HTTP ${res.status} — ${res.body}`);
  }

  const data = JSON.parse(res.body) as {
    payment_hash: string;
    payment_error: string;
    payment_route?: { total_fees_msat?: string };
  };

  if (data.payment_error) {
    throw new Error(`LND payment error: ${data.payment_error}`);
  }

  const feeMsat = parseInt(data.payment_route?.total_fees_msat ?? "0", 10);
  return {
    paymentHash: data.payment_hash,
    feeSats: Math.ceil(feeMsat / 1000),
  };
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

  const res = await requestJson(url, "POST", {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body).toString(),
    "Grpc-Metadata-Macaroon": macaroon,
  }, body);

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

export interface LndBalanceSummary {
  onchainConfirmed: number;
  onchainUnconfirmed: number;
  channelLocal: number;
  channelRemote: number;
}

export async function getLndBalance(): Promise<LndBalanceSummary> {
  const host = process.env.LND_HOST;
  const port = process.env.LND_PORT ?? "8080";
  const macaroon = process.env.LND_MACAROON_HEX;

  if (!host || !macaroon) {
    return { onchainConfirmed: 0, onchainUnconfirmed: 0, channelLocal: 0, channelRemote: 0 };
  }

  try {
    const [onchainRes, channelRes] = await Promise.all([
      requestJson(`https://${host}:${port}/v1/balance/blockchain`, "GET", {
        "Grpc-Metadata-Macaroon": macaroon,
      }),
      requestJson(`https://${host}:${port}/v1/balance/channels`, "GET", {
        "Grpc-Metadata-Macaroon": macaroon,
      }),
    ]);

    const onchain = onchainRes.status >= 200 && onchainRes.status < 300
      ? JSON.parse(onchainRes.body) as { confirmed_balance?: string; unconfirmed_balance?: string }
      : {};
    const channel = channelRes.status >= 200 && channelRes.status < 300
      ? JSON.parse(channelRes.body) as {
          local_balance?: { sat?: string };
          remote_balance?: { sat?: string };
        }
      : {};

    return {
      onchainConfirmed: parseInt(onchain.confirmed_balance ?? "0", 10),
      onchainUnconfirmed: parseInt(onchain.unconfirmed_balance ?? "0", 10),
      channelLocal: parseInt(channel.local_balance?.sat ?? "0", 10),
      channelRemote: parseInt(channel.remote_balance?.sat ?? "0", 10),
    };
  } catch {
    return { onchainConfirmed: 0, onchainUnconfirmed: 0, channelLocal: 0, channelRemote: 0 };
  }
}
