/**
 * Transport-level preflight: classify what kind of endpoint we're talking to
 * before running any readiness check.
 *
 * This is NOT a readiness check. It deliberately speaks the legacy
 * (pre-2026-07-28) `initialize` handshake because that's what today's deployed
 * servers answer — transport behavior stable since spec 2025-03-26. The
 * classification is conservative by design: it only decides whether the
 * endpoint is probeable (and what protocolVersion it speaks today), and can
 * NEVER produce a readiness fail. In particular, 401/403 means "auth-walled",
 * not "broken".
 */

import { isJsonRpcResponse, postJsonRpc } from "./client.js";
import type { Preflight, ProbeContext } from "./types.js";
import { CLIENT_INFO } from "./version.js";

function protocolVersionOf(body: unknown): string | undefined {
  if (!isJsonRpcResponse(body)) return undefined;
  const result = body["result"];
  if (typeof result !== "object" || result === null) return undefined;
  const version = (result as { protocolVersion?: unknown }).protocolVersion;
  return typeof version === "string" ? version : undefined;
}

/**
 * Pure classification table over the legacy-initialize response:
 *  - 401/403                                     → auth-required
 *  - 2xx + JSON-RPC result with protocolVersion  → open (baseline = that version)
 *  - any valid JSON-RPC envelope (incl. errors)  → open (it speaks JSON-RPC), no baseline
 *  - 429/5xx without an envelope                 → unreachable (transient — never assert not-mcp
 *                                                  off a rate limit or gateway error)
 *  - anything else (404/405/non-JSON-RPC body)   → not-mcp
 */
export function interpretInitialize(httpStatus: number, headers: Headers, body: unknown): Preflight {
  if (httpStatus === 401 || httpStatus === 403) {
    const www = headers.get("www-authenticate");
    return {
      access: "auth-required",
      detail: www
        ? `HTTP ${httpStatus}, WWW-Authenticate: ${www}`
        : `HTTP ${httpStatus} — endpoint requires credentials`,
    };
  }

  const baseline = protocolVersionOf(body);
  if (httpStatus >= 200 && httpStatus < 300 && baseline !== undefined) {
    const issuedSession = headers.get("mcp-session-id") !== null;
    return {
      access: "open",
      baseline,
      detail: `speaks ${baseline} (legacy initialize)${issuedSession ? " · issued Mcp-Session-Id" : ""}`,
    };
  }

  if (isJsonRpcResponse(body)) {
    return {
      access: "open",
      detail: `answers JSON-RPC (HTTP ${httpStatus}) but revealed no protocolVersion`,
    };
  }

  if (httpStatus === 429 || httpStatus >= 500) {
    return {
      access: "unreachable",
      detail: `HTTP ${httpStatus} — transient (rate limit or server error), couldn't test`,
    };
  }

  return {
    access: "not-mcp",
    detail: `HTTP ${httpStatus} with no JSON-RPC envelope — doesn't look like an MCP endpoint`,
  };
}

/** POST a legacy `initialize` and classify the endpoint. Network failure → unreachable. */
export async function classifyEndpoint(ctx: ProbeContext): Promise<Preflight> {
  try {
    const res = await postJsonRpc(
      ctx.url,
      "initialize",
      {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: CLIENT_INFO,
      },
      { timeoutMs: ctx.timeoutMs, headers: ctx.headers },
    );
    return interpretInitialize(res.httpStatus, res.headers, res.body);
  } catch (err) {
    return {
      access: "unreachable",
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}
