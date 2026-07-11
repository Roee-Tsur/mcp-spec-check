/**
 * 2026-07-28 adds CacheableResult (SEP-2549): ttlMs + cacheScope on the results
 * of tools/list, prompts/list, resources/list, resources/read, and
 * resources/templates/list. The RC marks them REQUIRED, but mcp-spec-check treats
 * their absence as a WARN, never a fail, during the beta window: (a) beta SDKs
 * may not emit them yet, so failing would flag genuinely-migrated servers;
 * (b) missing cache hints don't break interop the way discover/sessions do.
 * Revisit at GA (project rule 5 — optional features warn, never fail).
 */
import { rpcResult } from "../client.js";
import { acquireTransport } from "../probe-transport.js";
import { CACHE_SCOPES, FIX_URLS } from "../spec.js";
import type { CheckDefinition, CheckStatus } from "../types.js";

export function interpretCacheFields(
  result: Record<string, unknown> | undefined,
): { status: CheckStatus; detail: string } {
  if (!result) {
    return {
      status: "inconclusive",
      detail: "tools/list returned no result to inspect for cache metadata",
    };
  }
  const ttl = result["ttlMs"];
  const scope = result["cacheScope"];
  const hasTtl = typeof ttl === "number" && ttl >= 0;
  const hasScope = typeof scope === "string" && CACHE_SCOPES.has(scope);
  if (hasTtl && hasScope) {
    return { status: "pass", detail: `tools/list carries ttlMs=${ttl} and cacheScope=${scope}` };
  }
  if (!hasTtl && !hasScope) {
    return {
      status: "warn",
      detail:
        "tools/list carries neither ttlMs nor cacheScope (required in the RC; treated as warn during the beta window)",
    };
  }
  return {
    status: "warn",
    detail: `tools/list carries partial cache metadata (ttlMs ${hasTtl ? "present" : "missing"}, cacheScope ${
      hasScope ? "present" : "missing/invalid"
    })`,
  };
}

export const cacheMetadata: CheckDefinition = {
  id: "cache-metadata",
  title: "ttlMs / cacheScope on list responses",
  why: "New cache-control metadata on list/read responses (SEP-2549). Optional in mcp-spec-check's grading during the beta — absence is a warn, never a fail.",
  fixUrl: FIX_URLS.cacheMetadata,
  async run(ctx) {
    const t = await acquireTransport(ctx);
    if (t.mode === "none") {
      return {
        status: "inconclusive",
        detail: `couldn't establish a request mode to inspect cache metadata (${t.detail})`,
      };
    }
    const res = await t.send("tools/list", {});
    return interpretCacheFields(rpcResult(res.body));
  },
};
