/**
 * 2026-07-28 hardens authorization: a server that requires auth must publish
 * OAuth 2.0 Protected Resource Metadata (RFC 9728) at a well-known URL served
 * OUTSIDE the auth wall. That makes this the one check that yields signal on a
 * 401/403 endpoint — the runner opts it in via runsWhenAuthWalled.
 *
 * We GET the two RFC 9728 locations (origin-level and path-inserted) with no
 * credentials. A valid document → pass. On an auth-walled endpoint with no
 * document → warn (verify at GA exactly when it becomes MUST; warn keeps v0
 * conservative). On an open endpoint the metadata isn't required, so → skipped.
 */
import { getJson, type JsonGetResult } from "../client.js";
import { FIX_URLS } from "../spec.js";
import type { Access, CheckDefinition, CheckStatus } from "../types.js";

function protectedResourceOf(body: unknown): string | undefined {
  if (typeof body === "object" && body !== null && typeof (body as { resource?: unknown }).resource === "string") {
    return (body as { resource: string }).resource;
  }
  return undefined;
}

export function interpretAuthMetadata(
  access: Access | undefined,
  results: JsonGetResult[],
): { status: CheckStatus; detail: string } {
  for (const r of results) {
    if (r.httpStatus >= 200 && r.httpStatus < 300) {
      const resource = protectedResourceOf(r.body);
      if (resource) {
        return { status: "pass", detail: `OAuth protected-resource metadata found (resource: ${resource})` };
      }
    }
  }
  if (access === "auth-required") {
    return {
      status: "warn",
      detail:
        "endpoint requires auth but no RFC 9728 protected-resource metadata was found at the well-known paths",
    };
  }
  return {
    status: "skipped",
    detail: "endpoint doesn't require auth — protected-resource metadata not applicable",
  };
}

/** RFC 9728 well-known locations: origin-level and path-inserted (for /mcp-style endpoints). */
export function wellKnownUrls(target: string): string[] {
  const url = new URL(target);
  const path = url.pathname.replace(/\/+$/, "");
  const urls = [`${url.origin}/.well-known/oauth-protected-resource`];
  if (path && path !== "") urls.push(`${url.origin}/.well-known/oauth-protected-resource${path}`);
  return urls;
}

export const authMetadata: CheckDefinition = {
  id: "auth-metadata",
  title: "OAuth protected-resource metadata discoverable",
  why: "2026-07-28 hardens auth: servers requiring authorization must publish OAuth 2.0 Protected Resource Metadata (RFC 9728). The well-known document is origin-level and served outside the auth wall, so it's the one check that yields signal on 401 servers.",
  fixUrl: FIX_URLS.authMetadata,
  runsWhenAuthWalled: true,
  async run(ctx) {
    const urls = wellKnownUrls(ctx.url);
    const settled = await Promise.all(
      urls.map((u) => getJson(u, { timeoutMs: ctx.timeoutMs }).catch(() => undefined)),
    );
    const results = settled.filter((r): r is JsonGetResult => r !== undefined);
    return interpretAuthMetadata(ctx.preflight?.access, results);
  },
};
