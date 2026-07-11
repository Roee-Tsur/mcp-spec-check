import { NotImplementedError, type CheckDefinition } from "../types.js";

export const cacheMetadata: CheckDefinition = {
  id: "cache-metadata",
  title: "ttlMs / cacheScope on tool results",
  why: "New cache-control metadata on tool results in 2026-07-28; absence is a warn (optional), not a fail.",
  fixUrl:
    "https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/",
  async run() {
    // TODO: probe plan — call a read-only tool and inspect the result envelope for
    // ttlMs / cacheScope. Status should be "warn" when absent, never "fail".
    // TODO(verify): whether these fields are optional or required in the RC, and their exact names.
    throw new NotImplementedError("cache-metadata probes not implemented yet");
  },
};
