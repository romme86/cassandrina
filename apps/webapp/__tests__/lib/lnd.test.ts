/** @jest-environment node */

import { EventEmitter } from "node:events";

const requestMock = jest.fn();

jest.mock("node:https", () => ({
  __esModule: true,
  default: {
    request: (...args: unknown[]) => requestMock(...args),
  },
}));

describe("LND helpers", () => {
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

  test("honors LND_TLS_SKIP_VERIFY for self-signed LND endpoints", async () => {
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

    process.env.LND_TLS_SKIP_VERIFY = "true";

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

  test("uses the same TLS-aware HTTPS client for balance reads", async () => {
    requestMock.mockImplementation((options: any, callback: (res: EventEmitter & { statusCode?: number }) => void) => {
      const response = new EventEmitter() as EventEmitter & { statusCode?: number };
      response.statusCode = 200;

      process.nextTick(() => {
        callback(response);
        if (options.path === "/v1/balance/blockchain") {
          response.emit("data", Buffer.from(JSON.stringify({
            confirmed_balance: "123",
            unconfirmed_balance: "4",
          })));
        } else {
          response.emit("data", Buffer.from(JSON.stringify({
            local_balance: { sat: "56" },
            remote_balance: { sat: "78" },
          })));
        }
        response.emit("end");
      });

      return {
        on: jest.fn(),
        write: jest.fn(),
        end: jest.fn(),
      };
    });

    process.env.LND_TLS_SKIP_VERIFY = "true";

    const { getLndBalance } = await import("@/lib/lnd");
    await expect(getLndBalance()).resolves.toEqual({
      onchainConfirmed: 123,
      onchainUnconfirmed: 4,
      channelLocal: 56,
      channelRemote: 78,
    });

    expect(requestMock).toHaveBeenCalledTimes(2);
    expect(requestMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        method: "GET",
        path: "/v1/balance/blockchain",
        rejectUnauthorized: false,
      }),
      expect.any(Function)
    );
    expect(requestMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        method: "GET",
        path: "/v1/balance/channels",
        rejectUnauthorized: false,
      }),
      expect.any(Function)
    );
  });
});
