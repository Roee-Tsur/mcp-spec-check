import { describe, expect, it } from "vitest";
import { parseSseJson, rpcErrorCode } from "../src/client.js";

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
