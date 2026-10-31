/**
 * The 2026-07-28 spec requires Mcp-Method on every Streamable HTTP POST.
 * Mcp-Name is required only for tools/call, resources/read and prompts/get.
 * Servers must reject a header/body mismatch with HTTP 400 and
 * HeaderMismatch (-32020), so gateways can trust these headers (SEP-2243).
 *
 * This probe checks Mcp-Method consistency, not Mcp-Name validation.
 * We send a control request with correct headers, then one whose Mcp-Method
 * deliberately disagrees with the body. A server that accepts the mismatch is
 * not validating routing headers (fail). We probe through the shared transport
 * so a legacy server is exercised via its session too — it simply ignores the
 * header and returns a result, which is exactly the fail signal.
 */
import { rpcErrorCode, rpcResult } from "../client.js";
import { getTransport } from "../probe-transport.js";
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
  title: "Mcp-Method routing header validation",
  why: "Mcp-Method is required on each modern Streamable HTTP POST; this check verifies rejection of a mismatched method header. Mcp-Name is required only on named calls.",
  fixUrl: FIX_URLS.routingHeaders,
  async run(ctx) {
    const t = await getTransport(ctx);
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
