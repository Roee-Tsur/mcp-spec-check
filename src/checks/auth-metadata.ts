import { NotImplementedError, type CheckDefinition } from "../types.js";

export const authMetadata: CheckDefinition = {
  id: "auth-metadata",
  title: "OAuth protected-resource metadata discoverable",
  why: "2026-07-28 hardens auth: servers requiring authorization must publish OAuth 2.0 Protected Resource Metadata (RFC 9728). The well-known document is origin-level and served outside the auth wall, so this is the one check that yields scan signal on 401 servers.",
  fixUrl:
    "https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/",
  async run() {
    // TODO: probe plan —
    //  1. GET <origin>/.well-known/oauth-protected-resource (RFC 9728). Origin-level,
    //     works THROUGH auth walls — no credentials needed.
    //  2. 200 + JSON carrying a `resource` field → pass; missing/malformed → warn.
    // Warn-level (never fail) pending RC-text verification of exactly when the
    // metadata is mandatory (all servers vs. auth-required servers only).
    throw new NotImplementedError("auth-metadata probe not implemented yet");
  },
};
