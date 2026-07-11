import { describe, expect, it } from "vitest";
import { parseArgs } from "../src/args.js";

describe("parseArgs", () => {
  it("parses a bare URL with defaults", () => {
    const a = parseArgs(["https://example.com/mcp"]);
    expect(a.url).toBe("https://example.com/mcp");
    expect(a.timeoutMs).toBe(15_000);
    expect(a.verbose).toBe(false);
    expect(a.json).toBe(false);
    expect(a.headers).toEqual({});
    expect(a.error).toBeUndefined();
  });

  it("does not mistake a --bearer token for the URL", () => {
    const a = parseArgs(["--bearer", "not-a-url-token", "https://example.com/mcp"]);
    expect(a.url).toBe("https://example.com/mcp");
    expect(a.headers).toEqual({ Authorization: "Bearer not-a-url-token" });
    expect(a.error).toBeUndefined();
  });

  it("does not mistake a --timeout value for the URL", () => {
    const a = parseArgs(["--timeout", "5000", "https://example.com/mcp"]);
    expect(a.url).toBe("https://example.com/mcp");
    expect(a.timeoutMs).toBe(5000);
  });

  it("accepts flags after the URL", () => {
    const a = parseArgs(["https://example.com/mcp", "--json", "--verbose"]);
    expect(a.url).toBe("https://example.com/mcp");
    expect(a.json).toBe(true);
    expect(a.verbose).toBe(true);
  });

  it("splits --header on the first colon only", () => {
    const a = parseArgs(["--header", "X-Api-Key: abc:def", "https://example.com/mcp"]);
    expect(a.headers).toEqual({ "X-Api-Key": "abc:def" });
  });

  it("accumulates repeated --header flags", () => {
    const a = parseArgs([
      "--header",
      "X-One: 1",
      "--header",
      "X-Two: 2",
      "https://example.com/mcp",
    ]);
    expect(a.headers).toEqual({ "X-One": "1", "X-Two": "2" });
  });

  it("parses --help and --version", () => {
    expect(parseArgs(["--help"]).help).toBe(true);
    expect(parseArgs(["--version"]).version).toBe(true);
  });

  it("errors on --bearer without a token", () => {
    expect(parseArgs(["https://example.com/mcp", "--bearer"]).error).toMatch(/--bearer/);
  });

  it("errors on --header without a value", () => {
    expect(parseArgs(["--header"]).error).toMatch(/--header/);
  });

  it("errors on a malformed --header", () => {
    expect(parseArgs(["--header", "no-colon-here"]).error).toMatch(/invalid --header/);
    expect(parseArgs(["--header", ": value-without-name"]).error).toMatch(/invalid --header/);
  });

  it("errors on an invalid header name instead of probing with it", () => {
    // "X Api Key" would make fetch's Headers constructor throw, which the
    // preflight would misreport as the server being unreachable
    expect(parseArgs(["--header", "X Api Key: v"]).error).toMatch(/invalid --header/);
  });

  it("trims whitespace around header names and values", () => {
    expect(parseArgs(["--header", "X-Key : v ", "https://a.com"]).headers).toEqual({
      "X-Key": "v",
    });
  });

  it("errors on header values and bearer tokens with CR/LF", () => {
    expect(parseArgs(["--header", "X-Key: bad\nvalue"]).error).toMatch(/invalid --header/);
    expect(parseArgs(["--bearer", "tok\r\nen"]).error).toMatch(/--bearer/);
  });

  it("errors on a bad --timeout", () => {
    expect(parseArgs(["--timeout"]).error).toMatch(/--timeout/);
    expect(parseArgs(["--timeout", "soon"]).error).toMatch(/--timeout/);
    expect(parseArgs(["--timeout", "-5"]).error).toMatch(/--timeout/);
  });

  it("errors on an unknown flag", () => {
    expect(parseArgs(["--bogus", "https://example.com/mcp"]).error).toMatch(/unknown flag/);
  });

  it("errors on a second positional argument", () => {
    expect(parseArgs(["https://a.com", "https://b.com"]).error).toMatch(/unexpected argument/);
  });

  it("leaves url undefined when only flags are given", () => {
    expect(parseArgs(["--json"]).url).toBeUndefined();
  });
});
