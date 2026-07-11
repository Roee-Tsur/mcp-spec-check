import { NotImplementedError, type CheckDefinition } from "../types.js";

export const mrtr: CheckDefinition = {
  id: "mrtr",
  title: "Multi Round-Trip Requests (InputRequiredResult + requestState)",
  why: "Replaces SSE-based elicitation in 2026-07-28: server returns InputRequiredResult with opaque requestState; client echoes it back.",
  fixUrl:
    "https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/",
  async run() {
    // TODO: probe plan — hard to trigger black-box unless the server exposes an
    // elicitation-requiring tool. v0 approach: detect legacy SSE elicitation usage
    // (long-lived GET stream) as a fail-signal instead of proving MRTR positively.
    throw new NotImplementedError("MRTR probes not implemented yet");
  },
};
