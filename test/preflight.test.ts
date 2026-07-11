import { describe, expect, it } from "vitest";
import { interpretInitialize } from "../src/preflight.js";

const h = (init?: Record<string, string>) => new Headers(init);

const initializeResult = (protocolVersion: string) => ({
  jsonrpc: "2.0",
  id: 1,
  result: { protocolVersion, capabilities: {}, serverInfo: { name: "s", version: "1" } },
});

const rpcError = (code: number) => ({
  jsonrpc: "2.0",
  id: 1,
  error: { code, message: "boom" },
});

describe("interpretInitialize", () => {
  it("401 → auth-required", () => {
    const p = interpretInitialize(401, h(), undefined);
    expect(p.access).toBe("auth-required");
    expect(p.baseline).toBeUndefined();
  });

  it("403 → auth-required", () => {
    expect(interpretInitialize(403, h(), undefined).access).toBe("auth-required");
  });

  it("mentions WWW-Authenticate in the detail when present", () => {
    const p = interpretInitialize(401, h({ "www-authenticate": 'Bearer realm="mcp"' }), undefined);
    expect(p.access).toBe("auth-required");
    expect(p.detail).toContain("WWW-Authenticate");
    expect(p.detail).toContain('Bearer realm="mcp"');
  });

  it("401 wins even if the body carries a JSON-RPC envelope", () => {
    expect(interpretInitialize(401, h(), rpcError(-32000)).access).toBe("auth-required");
  });

  it("200 + initialize result → open with baseline", () => {
    const p = interpretInitialize(200, h(), initializeResult("2025-06-18"));
    expect(p.access).toBe("open");
    expect(p.baseline).toBe("2025-06-18");
    expect(p.detail).toContain("2025-06-18");
  });

  it("notes an issued Mcp-Session-Id", () => {
    const p = interpretInitialize(
      200,
      h({ "mcp-session-id": "abc123" }),
      initializeResult("2025-11-25"),
    );
    expect(p.access).toBe("open");
    expect(p.detail).toContain("Mcp-Session-Id");
  });

  it("stays silent about sessions when none was issued", () => {
    const p = interpretInitialize(200, h(), initializeResult("2025-11-25"));
    expect(p.detail).not.toContain("Mcp-Session-Id");
  });

  it("200 + JSON-RPC error envelope → open, no baseline", () => {
    const p = interpretInitialize(200, h(), rpcError(-32601));
    expect(p.access).toBe("open");
    expect(p.baseline).toBeUndefined();
  });

  it("400 + JSON-RPC error envelope → open (it speaks JSON-RPC)", () => {
    expect(interpretInitialize(400, h(), rpcError(-32600)).access).toBe("open");
  });

  it("200 + result without protocolVersion → open, no baseline", () => {
    const p = interpretInitialize(200, h(), { jsonrpc: "2.0", id: 1, result: {} });
    expect(p.access).toBe("open");
    expect(p.baseline).toBeUndefined();
  });

  it("404 with an HTML body → not-mcp", () => {
    expect(interpretInitialize(404, h(), undefined).access).toBe("not-mcp");
  });

  it("429 without an envelope → unreachable (transient), never not-mcp", () => {
    const p = interpretInitialize(429, h(), undefined);
    expect(p.access).toBe("unreachable");
    expect(p.detail).toContain("transient");
  });

  it("5xx without an envelope → unreachable (transient), never not-mcp", () => {
    expect(interpretInitialize(500, h(), undefined).access).toBe("unreachable");
    expect(interpretInitialize(502, h(), { some: "html" }).access).toBe("unreachable");
    expect(interpretInitialize(503, h(), undefined).access).toBe("unreachable");
  });

  it("5xx carrying a JSON-RPC envelope still counts as open", () => {
    expect(interpretInitialize(500, h(), rpcError(-32603)).access).toBe("open");
  });

  it("405 → not-mcp", () => {
    expect(interpretInitialize(405, h(), undefined).access).toBe("not-mcp");
  });

  it("200 with plain (non-envelope) JSON → not-mcp", () => {
    expect(interpretInitialize(200, h(), { hello: "world" }).access).toBe("not-mcp");
  });

  it("never returns a readiness verdict, only access classification", () => {
    for (const p of [
      interpretInitialize(401, h(), undefined),
      interpretInitialize(200, h(), initializeResult("2025-11-25")),
      interpretInitialize(404, h(), undefined),
    ]) {
      expect(["open", "auth-required", "not-mcp", "unreachable"]).toContain(p.access);
    }
  });
});
