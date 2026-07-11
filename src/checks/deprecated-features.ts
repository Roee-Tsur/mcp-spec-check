import { NotImplementedError, type CheckDefinition } from "../types.js";

export const deprecatedFeatures: CheckDefinition = {
  id: "deprecated-features",
  title: "No reliance on deprecated features (Roots / Sampling / Logging)",
  why: "All three enter deprecation in 2026-07-28 (12-month removal window). Reliance today = forced migration later.",
  fixUrl:
    "https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/",
  async run() {
    // TODO: probe plan — inspect declared capabilities / observed notifications for
    // logging notifications, sampling requests, roots usage. Status "warn" (deprecated,
    // not yet broken), never "fail" in v0.
    throw new NotImplementedError("deprecated-feature probes not implemented yet");
  },
};
