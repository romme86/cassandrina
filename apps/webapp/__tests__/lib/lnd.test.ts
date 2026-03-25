/** @jest-environment node */

import { EventEmitter } from "node:events";

const requestMock = jest.fn();

jest.mock("node:https", () => ({
  __esModule: true,
  default: {
    request: (...args: unknown[]) => requestMock(...args),
  },
}));

describe("createLndInvoice", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env = {
      ...originalEnv,
      LND_HOST: "192.168.1.223",
      LND_PORT: "8080",
      LND_MACAROON_HEX: "test-macaroon",
    };
    delete process.env.LND_TLS_CERT_PATH;
    delete process.env.LND_TLS_SKIP_VERIFY;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  test("disables TLS verification by default for self-signed LND endpoints", async () => {
    requestMock.mockImplementation((options: any, callback: (res: EventEmitter & { statusCode?: number }) => void) => {
      const response = new EventEmitter() as EventEmitter & { statusCode?: number };
      response.statusCode = 200;

      process.nextTick(() => {
        callback(response);
        response.emit(
          "data",
          Buffer.from(JSON.stringify({ payment_request: "lnbc1", r_hash: Buffer.from("abcd", "hex").toString("base64") }))
        );
        response.emit("end");
      });

      return {
        on: jest.fn(),
        write: jest.fn(),
        end: jest.fn(),
      };
    });

    const { createLndInvoice } = await import("@/lib/lnd");
    const result = await createLndInvoice(1200, "Cassandrina prediction", 3600);

    expect(result.paymentRequest).toBe("lnbc1");
    expect(result.rHashHex).toBe("abcd");
    expect(requestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        hostname: "192.168.1.223",
        port: "8080",
        rejectUnauthorized: false,
      }),
      expect.any(Function)
    );
  });
});
