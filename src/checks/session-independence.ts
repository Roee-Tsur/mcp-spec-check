import { NotImplementedError, type CheckDefinition } from "../types.js";

export const sessionIndependence: CheckDefinition = {
  id: "session-independence",
  title: "Works without Mcp-Session-Id (stateless)",
  why: "The protocol-level session is removed in 2026-07-28; servers pinned to session state can't serve the stateless core behind load balancers.",
  fixUrl:
    "https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/",
  async run() {
    // TODO: probe plan —
    //  1. Call tools/list (or equivalent) with NO session header and NO prior initialize.
    //     Old-spec servers typically 400/404 here; stateless servers answer.
    //  2. Simulate instance rotation: two consecutive requests, second one omitting
    //     any session/cookie state from the first. Both must succeed identically.
    throw new NotImplementedError("session-independence probes not implemented yet");
  },
};
