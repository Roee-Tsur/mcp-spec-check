/**
 * 2026-07-28 renumbers resource-not-found from -32002 to -32602 (Invalid Params)
 * to align with JSON-RPC (changelog / SEP-2549 era). We trigger it with a
 * resources/read on a URI that cannot exist and read the returned code.
 *
 * A server still emitting the legacy -32002 is a warn, not a fail: SDKs mid-
 * migration this month may lag, and warn (half credit) tolerates the old code
 * without crediting it as ready. (Empirically, recent SDKs already emit -32602,
 * so this check often passes even old-spec servers — it only catches genuinely
 * old error tables.) A server with no resources capability has no black-box
 * vehicle, so it is skipped rather than penalized.
 */
import { rpcErrorCode, rpcResult } from "../client.js";
import { getTransport } from "../probe-transport.js";
import { ERROR, FIX_URLS } from "../spec.js";
import type { CheckDefinition, CheckStatus } from "../types.js";

const PROBE_URI = "urn:mcp-spec-check:probe-does-not-exist";

export function interpretErrorCodeProbe(
  httpStatus: number,
  body: unknown,
): { status: CheckStatus; detail: string } {
  const code = rpcErrorCode(body);
  if (code === ERROR.invalidParams) {
    return {
      status: "pass",
      detail: "resource-not-found returns -32602 (Invalid Params), the 2026-07-28 code",
    };
  }
  if (code === ERROR.legacyResourceNotFound) {
    return {
      status: "warn",
      detail:
        "resource-not-found returns the legacy -32002; the RC renumbers it to -32602 — update before GA",
    };
  }
  if (code === ERROR.methodNotFound) {
    return {
      status: "skipped",
      detail:
        "server has no resources capability — no black-box vehicle to observe the renumbered error code",
    };
  }
  if (rpcResult(body)) {
    return {
      status: "inconclusive",
      detail: "the probe URI unexpectedly resolved — couldn't trigger a not-found error to inspect",
    };
  }
  return {
    status: "inconclusive",
    detail: `unexpected response probing resource-not-found (HTTP ${httpStatus}${
      code !== undefined ? `, code ${code}` : ""
    })`,
  };
}

export const errorCodes: CheckDefinition = {
  id: "error-codes",
  title: "Resource-not-found uses -32602 (not legacy -32002)",
  why: "2026-07-28 renumbers resource-not-found to -32602 (Invalid Params); clients built on the new spec key off the new code.",
  fixUrl: FIX_URLS.errorCodes,
  async run(ctx) {
    const t = await getTransport(ctx);
    if (t.mode === "none") {
      return {
        status: "inconclusive",
        detail: `couldn't establish a request mode to probe error codes (${t.detail})`,
      };
    }
    const res = await t.send("resources/read", { uri: PROBE_URI });
    return interpretErrorCodeProbe(res.httpStatus, res.body);
  },
};
