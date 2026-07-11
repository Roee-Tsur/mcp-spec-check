/**
 * 2026-07-28 requires the Mcp-Method (and Mcp-Name) routing headers on every
 * Streamable HTTP POST and requires servers to REJECT a request whose header
 * contradicts the body — HTTP 400 + HeaderMismatch (-32020) — so gateways can
 * route on the header without the body lying to them (SEP-2243).
 *
 * We send a control request with correct headers, then one whose Mcp-Method
 * deliberately disagrees with the body. A server that accepts the mismatch is
 * not validating routing headers (fail). We probe through the shared transport
 * so a legacy server is exercised via its session too — it simply ignores the
 * header and returns a result, which is exactly the fail signal.
 */
import { rpcErrorCode, rpcResult } from "../client.js";
import { acquireTransport } from "../probe-transport.js";
import { ERROR, FIX_URLS, HEADERS } from "../spec.js";
import type { CheckDefinition, CheckStatus } from "../types.js";

export function interpretRoutingProbes(
  control: { httpStatus: number; body: unknown },
  mismatch: { httpStatus: number; body: unknown },
): { status: CheckStatus; detail: string } {
  if (!rpcResult(control.body)) {
    return {
      status: "inconclusive",
      detail: "couldn't run a control request with correct routing headers — routing not evaluated",
    };
  }
  if (rpcResult(mismatch.body)) {
    return {
      status: "fail",
      detail:
        "server accepted a request whose Mcp-Method header contradicted the body — routing headers are not validated (SEP-2243 requires rejection)",
    };
  }
  const code = rpcErrorCode(mismatch.body);
  if (code === ERROR.headerMismatch || code === ERROR.legacyHeaderMismatch) {
    return {
      status: "pass",
      detail: `server rejected a header/body method mismatch with HeaderMismatch (${code})`,
    };
  }
  return {
    status: "warn",
    detail: `server rejected the mismatch but not with HeaderMismatch (HTTP ${mismatch.httpStatus}${
      code !== undefined ? `, code ${code}` : ""
    })`,
  };
}

export const routingHeaders: CheckDefinition = {
  id: "routing-headers",
  title: "Mcp-Method / Mcp-Name routing headers validated",
  why: "Required on every Streamable HTTP request in 2026-07-28; servers must reject header/body mismatches so gateways can route without inspecting the payload.",
  fixUrl: FIX_URLS.routingHeaders,
  async run(ctx) {
    const t = await acquireTransport(ctx);
    if (t.mode === "none") {
      return {
        status: "inconclusive",
        detail: `couldn't establish a request mode to test routing (${t.detail})`,
      };
    }
    const control = await t.send("tools/list", {});
    const mismatch = await t.send("tools/list", {}, {
      headerOverrides: { [HEADERS.method]: "prompts/get" },
    });
    return interpretRoutingProbes(control, mismatch);
  },
};
