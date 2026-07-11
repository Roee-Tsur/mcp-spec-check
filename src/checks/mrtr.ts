/**
 * Multi Round-Trip Requests (SEP-2322) replace server-initiated requests
 * (sampling / elicitation / roots) in 2026-07-28. Proving MRTR positively
 * black-box needs a tool that actually requires input, which we can't rely on —
 * so this is descoped to a cheap readiness signal: every 2026-07-28 result
 * carries a required `resultType` ("complete" | "input_required"). Its presence
 * on an ordinary result is a strong migration signal; its absence is a warn
 * (the pre-2026 shape), never a fail — the spec itself says clients treat an
 * omitted resultType as "complete" for earlier-protocol servers.
 *
 * As a secondary, detail-only signal we note the GET endpoint: 2026-07-28
 * removes it (→ 405), but a dual-version server legitimately keeps a legacy GET
 * SSE stream for old clients, so it never affects the verdict.
 */
import { getProbe, rpcResult, type GetProbeResult } from "../client.js";
import { acquireTransport } from "../probe-transport.js";
import { FIX_URLS, RESULT_TYPES } from "../spec.js";
import type { CheckDefinition, CheckStatus } from "../types.js";

function getNote(get: GetProbeResult | undefined): string {
  if (!get) return "";
  if (get.httpStatus === 405) return " (GET endpoint removed, per the RC)";
  if (get.contentType.includes("text/event-stream")) {
    return " (note: still serves a legacy GET SSE stream)";
  }
  return "";
}

export function interpretMrtr(
  result: Record<string, unknown> | undefined,
  get: GetProbeResult | undefined,
): { status: CheckStatus; detail: string } {
  const note = getNote(get);
  if (!result) {
    return { status: "inconclusive", detail: `no result available to inspect for resultType${note}` };
  }
  const resultType = result["resultType"];
  if (resultType === RESULT_TYPES.complete || resultType === RESULT_TYPES.inputRequired) {
    return { status: "pass", detail: `results carry resultType="${resultType}" (MRTR-ready)${note}` };
  }
  return {
    status: "warn",
    detail: `results omit the required resultType field (SEP-2322) — the pre-2026-07-28 shape${note}`,
  };
}

export const mrtr: CheckDefinition = {
  id: "mrtr",
  title: "Results carry resultType (MRTR-ready)",
  why: "2026-07-28 replaces server-initiated requests with Multi Round-Trip Requests; every result carries a required resultType field.",
  fixUrl: FIX_URLS.mrtr,
  async run(ctx) {
    const t = await acquireTransport(ctx);
    const get = await getProbe(ctx.url, {
      accept: "text/event-stream",
      timeoutMs: ctx.timeoutMs,
      headers: ctx.headers,
    }).catch(() => undefined);
    if (t.mode === "none") {
      return {
        status: "inconclusive",
        detail: `couldn't establish a request mode to inspect resultType${getNote(get)}`,
      };
    }
    const res = await t.send("tools/list", {});
    return interpretMrtr(rpcResult(res.body), get);
  },
};
