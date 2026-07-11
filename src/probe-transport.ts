/**
 * Shared request transport for checks that need "a working way to call a method"
 * on either server generation.
 *
 * The 2026-07-28 core is stateless, so the RC path is just a next-mode POST. But
 * the pre-2026 stateful servers we grade against reject every session-less
 * request with HTTP 400 before any interesting behavior can be observed — so we
 * fall back to a legacy `initialize` + `Mcp-Session-Id` and replay that session
 * on subsequent sends. Checks stay oblivious to which mode won; they call
 * `send()` and read the response.
 *
 * Modes:
 *  - "next":           server answers 2026-07-28 requests directly
 *  - "legacy-session": server needed a legacy initialize; session replayed
 *  - "none":           neither worked (checks degrade to warn/skipped, never throw)
 */
import {
  isJsonRpcResponse,
  isSessionRejection,
  postJsonRpc,
  postNext,
  rpcErrorCode,
  type NextRequestOptions,
  type RpcResponse,
} from "./client.js";
import { LEGACY_PROTOCOL_VERSION } from "./spec.js";
import type { ProbeContext } from "./types.js";
import { CLIENT_INFO } from "./version.js";

export type TransportMode = "next" | "legacy-session" | "none";

export interface Transport {
  mode: TransportMode;
  /** Human-readable note on how the mode was decided (surfaced in check detail). */
  detail: string;
  /**
   * Send a request in whatever mode was established. In next mode this is a full
   * 2026-07-28 envelope; in legacy-session mode it's a plain JSON-RPC POST with
   * the session header. `opts.headerOverrides` still apply in both, so a probe
   * can inject a routing header the legacy server will simply ignore.
   */
  send(
    method: string,
    params?: Record<string, unknown>,
    opts?: NextRequestOptions,
  ): Promise<RpcResponse>;
}

/** Error codes a modern (2026-07-28) server would return — used to tell "modern but errored" from "legacy". */
const MODERN_ERROR_CODES = new Set([-32020, -32021, -32022, -32602, -32601, -32600]);

/**
 * Decide whether a next-mode probe response proves the server speaks the modern
 * protocol: a JSON-RPC result, or a recognizably-modern JSON-RPC error — but not
 * a legacy session rejection. Exported for unit testing.
 */
export function speaksNext(res: RpcResponse): boolean {
  if (!isJsonRpcResponse(res.body)) return false;
  if (isSessionRejection(res.httpStatus, res.body)) return false;
  if ("result" in (res.body as Record<string, unknown>)) return true;
  const code = rpcErrorCode(res.body);
  return code !== undefined && MODERN_ERROR_CODES.has(code);
}

export async function acquireTransport(ctx: ProbeContext): Promise<Transport> {
  // 1. Try 2026-07-28 next mode.
  const probe = await postNext(ctx.url, "tools/list", {}, {
    timeoutMs: ctx.timeoutMs,
    headers: ctx.headers,
  });
  if (speaksNext(probe)) {
    return {
      mode: "next",
      detail: "server answers 2026-07-28 requests directly",
      send: (method, params = {}, opts = {}) =>
        postNext(ctx.url, method, params, {
          timeoutMs: ctx.timeoutMs,
          headers: ctx.headers,
          ...opts,
        }),
    };
  }

  // 2. Fall back to a legacy initialize + session.
  const init = await postJsonRpc(
    ctx.url,
    "initialize",
    {
      protocolVersion: LEGACY_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: CLIENT_INFO,
    },
    { timeoutMs: ctx.timeoutMs, headers: ctx.headers },
  );
  if (isJsonRpcResponse(init.body) && "result" in (init.body as Record<string, unknown>)) {
    const sessionId = init.headers.get("mcp-session-id") ?? undefined;
    const sessionHeaders = sessionId
      ? { ...ctx.headers, "mcp-session-id": sessionId }
      : { ...ctx.headers };
    return {
      mode: "legacy-session",
      detail: sessionId
        ? "server required a legacy initialize and Mcp-Session-Id"
        : "server answered a legacy initialize (no session id issued)",
      send: (method, params = {}, opts = {}) => {
        const headers: Record<string, string> = { ...sessionHeaders, ...(opts.headers ?? {}) };
        for (const [key, value] of Object.entries(opts.headerOverrides ?? {})) {
          if (value === null) delete headers[key];
          else headers[key] = value;
        }
        return postJsonRpc(ctx.url, method, params, { timeoutMs: ctx.timeoutMs, headers });
      },
    };
  }

  // 3. Neither worked — hand back the failed probe so callers can inspect it.
  return {
    mode: "none",
    detail: "couldn't establish a request mode (neither 2026-07-28 nor legacy initialize worked)",
    send: () => Promise.resolve(probe),
  };
}
