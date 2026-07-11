import { NotImplementedError, type CheckDefinition } from "../types.js";

export const errorCodes: CheckDefinition = {
  id: "error-codes",
  title: "New error codes (-32602 vs legacy -32002)",
  why: "2026-07-28 retires -32002 in favor of -32602; clients built on the new spec won't recognize the old code.",
  fixUrl:
    "https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/",
  async run() {
    // TODO: probe plan — trigger the error condition (e.g. invalid params on tools/call)
    // and inspect which code comes back.
    // TODO(verify): the exact condition that maps old -32002 → new -32602 in the RC text.
    throw new NotImplementedError("error-code probes not implemented yet");
  },
};
