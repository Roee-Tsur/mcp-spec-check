import { describe, expect, it } from "vitest";
import { interpretDiscover } from "../src/checks/discover.js";
import { interpretSessionProbes } from "../src/checks/session-independence.js";
import { interpretRoutingProbes } from "../src/checks/routing-headers.js";
import { interpretErrorCodeProbe } from "../src/checks/error-codes.js";
import { findDeprecatedCapabilities, interpretDeprecated } from "../src/checks/deprecated-features.js";
import { interpretCacheFields } from "../src/checks/cache-metadata.js";
import { interpretMrtr } from "../src/checks/mrtr.js";
import { interpretAuthMetadata, wellKnownUrls } from "../src/checks/auth-metadata.js";
import type { JsonGetResult } from "../src/client.js";

const result = (r: Record<string, unknown>) => ({ jsonrpc: "2.0", id: 1, result: r });
const error = (code: number, message = "boom") => ({ jsonrpc: "2.0", id: 1, error: { code, message } });
const sessionReject = { jsonrpc: "2.0", id: null, error: { code: -32000, message: "No valid session ID provided" } };

describe("interpretDiscover", () => {
  it("pass when supportedVersions includes the target", () => {
    expect(interpretDiscover(200, result({ supportedVersions: ["2026-07-28"] })).status).toBe("pass");
  });
  it("warn when supportedVersions omits the target", () => {
    expect(interpretDiscover(200, result({ supportedVersions: ["2025-11-25"] })).status).toBe("warn");
  });
  it("inconclusive when the result has no supportedVersions array", () => {
    expect(interpretDiscover(200, result({ serverInfo: {} })).status).toBe("inconclusive");
  });
  it("fail on a legacy session rejection", () => {
    expect(interpretDiscover(400, sessionReject).status).toBe("fail");
  });
  it("fail on method-not-found", () => {
    expect(interpretDiscover(200, error(-32601)).status).toBe("fail");
  });
  it("fail on a bare HTTP 404 with no envelope", () => {
    expect(interpretDiscover(404, undefined).status).toBe("fail");
  });
  it("inconclusive (never fail) when the server rejects our envelope", () => {
    expect(interpretDiscover(400, error(-32602)).status).toBe("inconclusive");
    expect(interpretDiscover(400, error(-32020)).status).toBe("inconclusive");
  });
});

describe("interpretSessionProbes", () => {
  const ok = { httpStatus: 200, body: result({ tools: [] }) };
  const reject = { httpStatus: 400, body: sessionReject };
  const other = { httpStatus: 500, body: error(-32603) };
  it("pass when both session-less requests return results", () => {
    expect(interpretSessionProbes(ok, ok).status).toBe("pass");
  });
  it("fail when either is a session rejection", () => {
    expect(interpretSessionProbes(ok, reject).status).toBe("fail");
    expect(interpretSessionProbes(reject, ok).status).toBe("fail");
  });
  it("inconclusive when ambiguous", () => {
    expect(interpretSessionProbes(other, other).status).toBe("inconclusive");
  });
});

describe("interpretRoutingProbes", () => {
  const ok = { httpStatus: 200, body: result({ tools: [] }) };
  it("inconclusive when the control request fails", () => {
    expect(interpretRoutingProbes({ httpStatus: 400, body: error(-32020) }, ok).status).toBe("inconclusive");
  });
  it("fail when the mismatch is accepted (returns a result)", () => {
    expect(interpretRoutingProbes(ok, ok).status).toBe("fail");
  });
  it("pass when the mismatch is rejected with HeaderMismatch (-32020 or legacy -32001)", () => {
    expect(interpretRoutingProbes(ok, { httpStatus: 400, body: error(-32020) }).status).toBe("pass");
    expect(interpretRoutingProbes(ok, { httpStatus: 400, body: error(-32001) }).status).toBe("pass");
  });
  it("warn when the mismatch is rejected with some other error", () => {
    expect(interpretRoutingProbes(ok, { httpStatus: 400, body: error(-32603) }).status).toBe("warn");
  });
});

describe("interpretErrorCodeProbe", () => {
  it("pass on -32602 (renumbered)", () => {
    expect(interpretErrorCodeProbe(200, error(-32602)).status).toBe("pass");
  });
  it("warn on the legacy -32002", () => {
    expect(interpretErrorCodeProbe(200, error(-32002)).status).toBe("warn");
  });
  it("skipped when there is no resources capability (-32601)", () => {
    expect(interpretErrorCodeProbe(200, error(-32601)).status).toBe("skipped");
  });
  it("inconclusive when the probe URI unexpectedly resolves", () => {
    expect(interpretErrorCodeProbe(200, result({ contents: [] })).status).toBe("inconclusive");
  });
});

describe("deprecated-features", () => {
  it("finds logging and resources.subscribe", () => {
    const found = findDeprecatedCapabilities({ logging: {}, resources: { subscribe: true } });
    expect(found.length).toBe(2);
  });
  it("finds nothing in a clean capability set", () => {
    expect(findDeprecatedCapabilities({ tools: { listChanged: true }, resources: { listChanged: true } })).toEqual([]);
  });
  it("treats subscribe:false as not present", () => {
    expect(findDeprecatedCapabilities({ resources: { subscribe: false } })).toEqual([]);
  });
  it("interpret: warn when deprecated caps declared, pass when clean, inconclusive when unknown", () => {
    expect(interpretDeprecated({ logging: {} }).status).toBe("warn");
    expect(interpretDeprecated({ tools: {} }).status).toBe("pass");
    expect(interpretDeprecated(undefined).status).toBe("inconclusive");
  });
});

describe("interpretCacheFields", () => {
  it("pass with valid ttlMs and cacheScope", () => {
    expect(interpretCacheFields({ ttlMs: 0, cacheScope: "private" }).status).toBe("pass");
    expect(interpretCacheFields({ ttlMs: 5000, cacheScope: "public" }).status).toBe("pass");
  });
  it("warn when both are absent", () => {
    expect(interpretCacheFields({ tools: [] }).status).toBe("warn");
  });
  it("warn on partial or invalid metadata", () => {
    expect(interpretCacheFields({ ttlMs: 5000 }).status).toBe("warn");
    expect(interpretCacheFields({ ttlMs: 5000, cacheScope: "bogus" }).status).toBe("warn");
  });
  it("inconclusive when there is no result", () => {
    expect(interpretCacheFields(undefined).status).toBe("inconclusive");
  });
});

describe("interpretMrtr", () => {
  it("pass when resultType is present", () => {
    expect(interpretMrtr({ resultType: "complete" }, undefined).status).toBe("pass");
    expect(interpretMrtr({ resultType: "input_required" }, undefined).status).toBe("pass");
  });
  it("warn when resultType is absent from a result", () => {
    expect(interpretMrtr({ tools: [] }, undefined).status).toBe("warn");
  });
  it("inconclusive when there is no result to inspect", () => {
    expect(interpretMrtr(undefined, undefined).status).toBe("inconclusive");
  });
  it("notes a removed GET endpoint (405) in the detail", () => {
    const r = interpretMrtr({ resultType: "complete" }, { httpStatus: 405, headers: new Headers(), contentType: "" });
    expect(r.detail).toContain("GET endpoint removed");
  });
});

describe("auth-metadata", () => {
  const doc = (resource: string): JsonGetResult => ({
    httpStatus: 200,
    headers: new Headers(),
    body: { resource, authorization_servers: ["https://as.example"] },
  });
  const miss: JsonGetResult = { httpStatus: 404, headers: new Headers(), body: undefined };

  it("pass on a valid protected-resource document", () => {
    expect(interpretAuthMetadata("open", [doc("https://api.example/mcp")]).status).toBe("pass");
  });
  it("warn when auth-walled but no document", () => {
    expect(interpretAuthMetadata("auth-required", [miss]).status).toBe("warn");
  });
  it("skipped when open and no document (not applicable)", () => {
    expect(interpretAuthMetadata("open", [miss]).status).toBe("skipped");
    expect(interpretAuthMetadata(undefined, []).status).toBe("skipped");
  });
  it("builds origin-level and path-inserted well-known URLs", () => {
    expect(wellKnownUrls("https://api.example/mcp")).toEqual([
      "https://api.example/.well-known/oauth-protected-resource",
      "https://api.example/.well-known/oauth-protected-resource/mcp",
    ]);
  });
  it("emits only the origin-level URL when there's no path", () => {
    expect(wellKnownUrls("https://api.example/")).toEqual([
      "https://api.example/.well-known/oauth-protected-resource",
    ]);
  });
});
