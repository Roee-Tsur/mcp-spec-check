import { describe, expect, it } from "vitest";
import { getTransport, speaksNext, type Transport } from "../src/probe-transport.js";
import type { RpcResponse } from "../src/client.js";
import type { ProbeContext } from "../src/types.js";

const res = (httpStatus: number, body: unknown): RpcResponse => ({
  httpStatus,
  headers: new Headers(),
  body,
  rawBody: "",
});

describe("speaksNext", () => {
  it("true for a JSON-RPC result", () => {
    expect(speaksNext(res(200, { jsonrpc: "2.0", id: 1, result: { tools: [] } }))).toBe(true);
  });

  it("true for a modern JSON-RPC error (HeaderMismatch -32020)", () => {
    expect(
      speaksNext(res(400, { jsonrpc: "2.0", id: 1, error: { code: -32020, message: "header mismatch" } })),
    ).toBe(true);
  });

  it("true for method-not-found (-32601) — modern server, unknown method", () => {
    expect(
      speaksNext(res(404, { jsonrpc: "2.0", id: 1, error: { code: -32601, message: "Method not found" } })),
    ).toBe(true);
  });

  it("false for a legacy session rejection (-32000 'No valid session ID')", () => {
    expect(
      speaksNext(
        res(400, { jsonrpc: "2.0", id: null, error: { code: -32000, message: "No valid session ID provided" } }),
      ),
    ).toBe(false);
  });

  it("false for a non-JSON-RPC body", () => {
    expect(speaksNext(res(404, undefined))).toBe(false);
    expect(speaksNext(res(200, { hello: "world" }))).toBe(false);
  });

  it("false for a generic implementation-defined error that isn't modern-MCP", () => {
    expect(
      speaksNext(res(500, { jsonrpc: "2.0", id: 1, error: { code: -32000, message: "boom" } })),
    ).toBe(false);
  });
});

describe("getTransport", () => {
  it("returns the already-memoized transport without re-acquiring", () => {
    // Pre-seed ctx.transport: getTransport must hand back that exact promise
    // (the `??=` memoization) rather than kick off a fresh network acquisition.
    const fake: Promise<Transport> = Promise.resolve({
      mode: "next",
      detail: "seeded",
      send: async () => res(200, { jsonrpc: "2.0", id: 1, result: {} }),
    });
    const ctx = { url: "http://x", timeoutMs: 1, verbose: false, headers: {}, transport: fake } as ProbeContext;
    expect(getTransport(ctx)).toBe(fake);
    expect(getTransport(ctx)).toBe(fake);
  });
});
