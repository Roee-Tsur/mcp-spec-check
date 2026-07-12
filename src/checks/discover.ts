/**
 * server/discover replaces the initialize handshake in the 2026-07-28 stateless
 * core (SEP-2575). Servers MUST implement it and advertise their supported
 * protocol versions. We probe it in full next-mode (the required _meta identity
 * + MCP-Protocol-Version / Mcp-Method headers) so a strict RC server can't
 * reject our own request and yield a false "not ready".
 *
 * fail is reserved for positive legacy signals — an unimplemented method or a
 * legacy session lifecycle. Anything ambiguous (including a discover result we
 * can't parse) is inconclusive, never a fail.
 */
import { postNext, rpcErrorCode, isSessionRejection, rpcResult } from "../client.js";
import { ERROR, FIX_URLS, TARGET_PROTOCOL_VERSION } from "../spec.js";
import type { CheckDefinition, CheckStatus } from "../types.js";

export function interpretDiscover(
  httpStatus: number,
  body: unknown,
): { status: CheckStatus; detail: string; data?: Record<string, unknown> } {
  const result = rpcResult(body);
  if (result && Array.isArray(result["supportedVersions"])) {
    const versions = (result["supportedVersions"] as unknown[]).filter(
      (v): v is string => typeof v === "string",
    );
    // Surface the advertised versions for the scan's version histogram, on both
    // the pass (lists the target) and warn (works but omits it) branches.
    const data = { supportedVersions: versions };
    if (versions.includes(TARGET_PROTOCOL_VERSION)) {
      return { status: "pass", detail: `server/discover advertises ${versions.join(", ")}`, data };
    }
    return {
      status: "warn",
      detail: `server/discover works but doesn't list ${TARGET_PROTOCOL_VERSION} (advertises ${
        versions.join(", ") || "no versions"
      })`,
      data,
    };
  }
  if (result) {
    return {
      status: "inconclusive",
      detail: "server/discover answered but with an unexpected shape (no supportedVersions array)",
    };
  }

  if (isSessionRejection(httpStatus, body)) {
    return {
      status: "fail",
      detail:
        "server requires a legacy session before any request — a pre-2026-07-28 lifecycle with no server/discover",
    };
  }

  const code = rpcErrorCode(body);
  if (code === ERROR.methodNotFound || httpStatus === 404) {
    return {
      status: "fail",
      detail:
        "server/discover is not implemented (method-not-found) — server has not migrated to the 2026-07-28 stateless core",
    };
  }

  if (code === ERROR.invalidParams || code === -32600 || code === ERROR.headerMismatch) {
    return {
      status: "inconclusive",
      detail: `server rejected the server/discover probe (code ${code}) — it may speak 2026-07-28 but this couldn't be confirmed`,
    };
  }

  return {
    status: "inconclusive",
    detail: `ambiguous response to server/discover (HTTP ${httpStatus}${
      code !== undefined ? `, code ${code}` : ""
    })`,
  };
}

export const discover: CheckDefinition = {
  id: "discover",
  title: "server/discover supported",
  why: "Replaces the initialize handshake in the 2026-07-28 stateless core; servers MUST implement it.",
  fixUrl: FIX_URLS.discover,
  async run(ctx) {
    const res = await postNext(ctx.url, "server/discover", {}, {
      timeoutMs: ctx.timeoutMs,
      headers: ctx.headers,
    });
    return interpretDiscover(res.httpStatus, res.body);
  },
};
