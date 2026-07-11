import { NotImplementedError, type CheckDefinition } from "../types.js";

export const routingHeaders: CheckDefinition = {
  id: "routing-headers",
  title: "Mcp-Method / Mcp-Name routing headers handled",
  why: "Required on every Streamable HTTP request in 2026-07-28; enables gateway routing without payload inspection.",
  fixUrl:
    "https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/",
  async run() {
    // TODO: probe plan —
    //  1. Send a valid request WITH correct routing headers → expect success.
    //  2. Send with header/body method MISMATCH → a compliant server must reject.
    //  3. Send WITHOUT headers → observe behavior (new-spec servers should reject or tolerate per spec).
    // TODO(verify): exact header names and the mandated mismatch behavior, from the RC text.
    throw new NotImplementedError("routing-header probes not implemented yet");
  },
};
