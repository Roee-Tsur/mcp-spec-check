/**
 * The protocol-level session and the Mcp-Session-Id header are removed in
 * 2026-07-28 (SEP-2567): list endpoints no longer vary per-connection and
 * servers behind a load balancer must answer any request on any instance. We
 * send two independent next-mode requests carrying no session state; both must
 * succeed. A server that rejects a session-less request still depends on the
 * removed lifecycle and fails.
 */
import { postNext, rpcErrorCode, isSessionRejection, rpcResult } from "../client.js";
import { ERROR, FIX_URLS } from "../spec.js";
import type { CheckDefinition, CheckStatus } from "../types.js";

type Outcome = "ok" | "session-rejection" | "other";

function outcome(httpStatus: number, body: unknown): Outcome {
  if (rpcResult(body)) return "ok";
  if (isSessionRejection(httpStatus, body)) return "session-rejection";
  return "other";
}

export function interpretSessionProbes(
  a: { httpStatus: number; body: unknown },
  b: { httpStatus: number; body: unknown },
): { status: CheckStatus; detail: string } {
  const oa = outcome(a.httpStatus, a.body);
  const ob = outcome(b.httpStatus, b.body);
  if (oa === "ok" && ob === "ok") {
    return {
      status: "pass",
      detail: "two independent session-less requests both succeeded — stateless",
    };
  }
  if (oa === "session-rejection" || ob === "session-rejection") {
    return {
      status: "fail",
      detail:
        "server rejected a session-less request — it still depends on the Mcp-Session-Id lifecycle removed in 2026-07-28",
    };
  }
  return {
    status: "inconclusive",
    detail: `couldn't confirm statelessness (request outcomes: ${oa}, ${ob})`,
  };
}

export const sessionIndependence: CheckDefinition = {
  id: "session-independence",
  title: "Works without Mcp-Session-Id (stateless)",
  why: "The protocol-level session is removed in 2026-07-28; servers pinned to session state can't serve the stateless core behind load balancers.",
  fixUrl: FIX_URLS.sessionIndependence,
  async run(ctx) {
    const opts = { timeoutMs: ctx.timeoutMs, headers: ctx.headers };
    const first = await postNext(ctx.url, "tools/list", {}, opts);
    // A modern server without a tools capability answers -32601; fall back to
    // server/discover, which every 2026-07-28 server implements statelessly.
    const useDiscover = rpcErrorCode(first.body) === ERROR.methodNotFound;
    const method = useDiscover ? "server/discover" : "tools/list";
    const a = useDiscover ? await postNext(ctx.url, method, {}, opts) : first;
    const b = await postNext(ctx.url, method, {}, opts);
    return interpretSessionProbes(a, b);
  },
};
