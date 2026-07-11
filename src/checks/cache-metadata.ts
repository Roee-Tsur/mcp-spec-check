import { NotImplementedError, type CheckDefinition } from "../types.js";

export const cacheMetadata: CheckDefinition = {
  id: "cache-metadata",
  title: "ttlMs / cacheScope on list/read responses",
  why: "New cache-control metadata on list/read responses (SEP-2549) in 2026-07-28; absence is a warn (optional), not a fail.",
  fixUrl:
    "https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/",
  async run() {
    // TODO: probe plan — call tools/list (or a resource read) and inspect the
    // response envelope for ttlMs / cacheScope. Status should be "warn" when
    // absent, never "fail".
    // TODO(verify): whether these fields are optional or required in the RC, and their exact names.
    throw new NotImplementedError("cache-metadata probes not implemented yet");
  },
};
