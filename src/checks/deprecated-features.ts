/**
 * Roots, Sampling and Logging are deprecated in 2026-07-28 (SEP-2577), and
 * resources/subscribe is removed in favor of subscriptions/listen (SEP-2575).
 * Roots and Sampling are client capabilities and not observable black-box, but
 * a server DECLARES logging and resources.subscribe in its capabilities, so we
 * read those (from server/discover, else a legacy initialize) and warn on any
 * deprecated/removed capability. Never a fail — these still work during the
 * 12-month deprecation window.
 */
import { isJsonRpcResponse, postJsonRpc, postNext, rpcResult } from "../client.js";
import { DEPRECATED_CAPABILITIES, FIX_URLS, LEGACY_PROTOCOL_VERSION } from "../spec.js";
import type { CheckDefinition, CheckStatus } from "../types.js";
import { CLIENT_INFO } from "../version.js";

function capabilitiesOf(body: unknown): Record<string, unknown> | undefined {
  const result = rpcResult(body);
  if (result && typeof result["capabilities"] === "object" && result["capabilities"] !== null) {
    return result["capabilities"] as Record<string, unknown>;
  }
  return undefined;
}

function hasCapabilityPath(capabilities: Record<string, unknown>, path: string): boolean {
  let current: unknown = capabilities;
  for (const part of path.split(".")) {
    if (typeof current !== "object" || current === null) return false;
    current = (current as Record<string, unknown>)[part];
  }
  return current !== undefined && current !== false;
}

export function findDeprecatedCapabilities(capabilities: Record<string, unknown>): string[] {
  const found: string[] = [];
  for (const { path, note } of DEPRECATED_CAPABILITIES) {
    if (hasCapabilityPath(capabilities, path)) found.push(note);
  }
  return found;
}

export function interpretDeprecated(
  capabilities: Record<string, unknown> | undefined,
): { status: CheckStatus; detail: string } {
  if (!capabilities) {
    return { status: "skipped", detail: "couldn't read server capabilities to inspect for deprecated features" };
  }
  const found = findDeprecatedCapabilities(capabilities);
  if (found.length === 0) {
    return {
      status: "pass",
      detail: "declares no deprecated capabilities (Roots/Sampling are client-side and not observable)",
    };
  }
  return { status: "warn", detail: `declares deprecated/removed capabilities — ${found.join("; ")}` };
}

export const deprecatedFeatures: CheckDefinition = {
  id: "deprecated-features",
  title: "No reliance on deprecated features (Logging / resources.subscribe)",
  why: "Logging is deprecated and resources/subscribe is removed in 2026-07-28. Reliance today means forced migration later.",
  fixUrl: FIX_URLS.deprecatedFeatures,
  async run(ctx) {
    const opts = { timeoutMs: ctx.timeoutMs, headers: ctx.headers };
    const disc = await postNext(ctx.url, "server/discover", {}, opts);
    let capabilities = capabilitiesOf(disc.body);
    if (!capabilities) {
      const init = await postJsonRpc(
        ctx.url,
        "initialize",
        {
          protocolVersion: LEGACY_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: CLIENT_INFO,
        },
        opts,
      );
      if (isJsonRpcResponse(init.body)) capabilities = capabilitiesOf(init.body);
    }
    return interpretDeprecated(capabilities);
  },
};
