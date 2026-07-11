import { postJsonRpc, rpcErrorCode } from "../client.js";
import type { CheckDefinition } from "../types.js";

/**
 * The 2026-07-28 spec replaces the initialize handshake with server/discover.
 * A server that returns method-not-found for it has not migrated.
 *
 * TODO(verify): exact method name, required routing headers on this call,
 * and expected result shape — check the RC spec before trusting this probe.
 */
export const discover: CheckDefinition = {
  id: "discover",
  title: "server/discover supported",
  why: "Replaces the initialize handshake in the 2026-07-28 stateless core.",
  fixUrl:
    "https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/",
  async run(ctx) {
    const res = await postJsonRpc(ctx.url, "server/discover", {}, {
      timeoutMs: ctx.timeoutMs,
      headers: { ...ctx.headers, "Mcp-Method": "server/discover" },
    });
    const code = rpcErrorCode(res.body);
    if (code === -32601) {
      return {
        status: "fail",
        detail: "server/discover returned method-not-found (-32601) — server has not migrated",
      };
    }
    if (res.httpStatus >= 200 && res.httpStatus < 300 && res.body !== undefined) {
      // TODO(verify): validate the discover result shape against the RC schema.
      return { status: "pass", detail: "server/discover answered with a JSON body" };
    }
    return {
      status: "warn",
      detail: `Ambiguous response (HTTP ${res.httpStatus}) — inspect manually`,
    };
  },
};
