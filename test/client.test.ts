import { describe, expect, it } from "vitest";
import {
  buildNextRequest,
  isSessionRejection,
  parseSseJson,
  rpcErrorCode,
  rpcErrorMessage,
} from "../src/client.js";
import { HEADERS, META_KEYS, TARGET_PROTOCOL_VERSION } from "../src/spec.js";

describe("parseSseJson", () => {
  it("extracts a single data event", () => {
    const body = 'event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{}}\n\n';
    expect(parseSseJson(body)).toEqual({ jsonrpc: "2.0", id: 1, result: {} });
  });

  it("works without an event: line", () => {
    expect(parseSseJson('data: {"a":1}\n\n')).toEqual({ a: 1 });
  });

  it("works without a trailing blank line", () => {
    expect(parseSseJson('data: {"a":1}')).toEqual({ a: 1 });
  });

  it("handles CRLF line endings", () => {
    expect(parseSseJson('event: message\r\ndata: {"a":1}\r\n\r\n')).toEqual({ a: 1 });
  });

  it("handles data: with no space after the colon", () => {
    expect(parseSseJson('data:{"a":1}\n\n')).toEqual({ a: 1 });
  });

  it("joins multi-line data fields within one event", () => {
    expect(parseSseJson('data: {"a":\ndata: 1}\n\n')).toEqual({ a: 1 });
  });

  it("returns the first event when several are present and none is a response", () => {
    const body = 'data: {"first":true}\n\ndata: {"second":true}\n\n';
    expect(parseSseJson(body)).toEqual({ first: true });
  });

  it("prefers a JSON-RPC response over a notification that precedes it", () => {
    const body =
      'data: {"jsonrpc":"2.0","method":"notifications/message","params":{}}\n\n' +
      'data: {"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-11-25"}}\n\n';
    expect(parseSseJson(body)).toEqual({
      jsonrpc: "2.0",
      id: 1,
      result: { protocolVersion: "2025-11-25" },
    });
  });

  it("prefers a JSON-RPC error response over a preceding notification", () => {
    const body =
      'data: {"jsonrpc":"2.0","method":"notifications/message"}\n\n' +
      'data: {"jsonrpc":"2.0","id":1,"error":{"code":-32601,"message":"x"}}\n\n';
    expect(parseSseJson(body)).toEqual({
      jsonrpc: "2.0",
      id: 1,
      error: { code: -32601, message: "x" },
    });
  });

  it("ignores keepalive comment lines between events", () => {
    const body = ': keepalive\n\ndata: {"jsonrpc":"2.0","id":1,"result":{}}\n\n: keepalive\n\n';
    expect(parseSseJson(body)).toEqual({ jsonrpc: "2.0", id: 1, result: {} });
  });

  it("returns undefined when there is no data event", () => {
    expect(parseSseJson(": keepalive\n\n")).toBeUndefined();
    expect(parseSseJson("")).toBeUndefined();
    expect(parseSseJson('{"plain":"json"}')).toBeUndefined();
  });

  it("returns undefined when the data payload isn't JSON", () => {
    expect(parseSseJson("data: not json\n\n")).toBeUndefined();
  });
});

describe("rpcErrorCode", () => {
  it("extracts a numeric error code", () => {
    expect(rpcErrorCode({ jsonrpc: "2.0", id: 1, error: { code: -32602, message: "x" } })).toBe(
      -32602,
    );
  });

  it("returns undefined for results and malformed bodies", () => {
    expect(rpcErrorCode({ jsonrpc: "2.0", id: 1, result: {} })).toBeUndefined();
    expect(rpcErrorCode({ error: { code: "-32602" } })).toBeUndefined();
    expect(rpcErrorCode(undefined)).toBeUndefined();
    expect(rpcErrorCode("nope")).toBeUndefined();
  });
});

describe("rpcErrorMessage", () => {
  it("extracts the error message", () => {
    expect(rpcErrorMessage({ error: { code: -32000, message: "No valid session ID" } })).toBe(
      "No valid session ID",
    );
  });
  it("returns undefined when absent", () => {
    expect(rpcErrorMessage({ result: {} })).toBeUndefined();
    expect(rpcErrorMessage(undefined)).toBeUndefined();
  });
});

describe("isSessionRejection", () => {
  it("true for the old SDK's session-less rejection", () => {
    expect(
      isSessionRejection(400, {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32000, message: "Bad Request: No valid session ID provided" },
      }),
    ).toBe(true);
  });
  it("true for a 'Server not initialized' message", () => {
    expect(isSessionRejection(400, { error: { code: -32602, message: "Server not initialized" } })).toBe(
      true,
    );
  });
  it("false for modern header-mismatch and version errors (no session wording)", () => {
    expect(isSessionRejection(400, { error: { code: -32020, message: "Header mismatch" } })).toBe(false);
    expect(
      isSessionRejection(400, { error: { code: -32022, message: "Unsupported protocol version" } }),
    ).toBe(false);
  });
  it("false when there is no error message", () => {
    expect(isSessionRejection(200, { result: {} })).toBe(false);
  });
});

describe("buildNextRequest", () => {
  it("injects the three required _meta identity keys", () => {
    const { params } = buildNextRequest("tools/list", {});
    const meta = params["_meta"] as Record<string, unknown>;
    expect(meta[META_KEYS.protocolVersion]).toBe(TARGET_PROTOCOL_VERSION);
    expect(meta[META_KEYS.clientInfo]).toEqual({ name: "mcp-ready", version: "0.0.1" });
    expect(meta[META_KEYS.clientCapabilities]).toEqual({});
  });

  it("sets the protocol-version and Mcp-Method headers", () => {
    const { headers } = buildNextRequest("tools/list", {});
    expect(headers[HEADERS.protocolVersion]).toBe(TARGET_PROTOCOL_VERSION);
    expect(headers[HEADERS.method]).toBe("tools/list");
    expect(headers[HEADERS.name]).toBeUndefined();
  });

  it("adds Mcp-Name from params.name for tools/call", () => {
    const { headers } = buildNextRequest("tools/call", { name: "get_weather" });
    expect(headers[HEADERS.name]).toBe("get_weather");
  });

  it("adds Mcp-Name from params.uri for resources/read", () => {
    const { headers } = buildNextRequest("resources/read", { uri: "file:///x" });
    expect(headers[HEADERS.name]).toBe("file:///x");
  });

  it("omits Mcp-Name for methods that don't require it", () => {
    expect(buildNextRequest("prompts/list", {}).headers[HEADERS.name]).toBeUndefined();
  });

  it("preserves caller-supplied _meta keys", () => {
    const { params } = buildNextRequest("tools/list", {
      _meta: { "io.modelcontextprotocol/logLevel": "debug" },
    });
    const meta = params["_meta"] as Record<string, unknown>;
    expect(meta["io.modelcontextprotocol/logLevel"]).toBe("debug");
    expect(meta[META_KEYS.protocolVersion]).toBe(TARGET_PROTOCOL_VERSION);
  });

  it("lets headerOverrides replace a routing header (mismatch probe)", () => {
    const { headers } = buildNextRequest("tools/list", {}, {
      headerOverrides: { [HEADERS.method]: "prompts/get" },
    });
    expect(headers[HEADERS.method]).toBe("prompts/get");
  });

  it("lets headerOverrides drop a routing header with null (absence probe)", () => {
    const { headers } = buildNextRequest("tools/list", {}, {
      headerOverrides: { [HEADERS.method]: null },
    });
    expect(headers[HEADERS.method]).toBeUndefined();
  });

  it("applies a protocolVersion override to both the header and _meta", () => {
    const { params, headers } = buildNextRequest("tools/list", {}, {
      protocolVersion: "2025-11-25",
    });
    expect(headers[HEADERS.protocolVersion]).toBe("2025-11-25");
    expect((params["_meta"] as Record<string, unknown>)[META_KEYS.protocolVersion]).toBe(
      "2025-11-25",
    );
  });

  it("merges caller headers (e.g. Authorization)", () => {
    const { headers } = buildNextRequest("tools/list", {}, {
      headers: { Authorization: "Bearer xyz" },
    });
    expect(headers["Authorization"]).toBe("Bearer xyz");
    expect(headers[HEADERS.method]).toBe("tools/list");
  });
});
