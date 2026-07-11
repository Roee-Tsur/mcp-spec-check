/**
 * RC reference server — speaks the MCP 2026-07-28 spec via the v2 TypeScript
 * SDK beta (@modelcontextprotocol/server). The POSITIVE fixture: every check
 * should pass (or warn only where the beta lags the spec text).
 *
 * createMcpHandler owns the whole 2026-07-28 surface — server/discover, routing
 * header validation, statelessness, CacheableResult metadata, resultType — so
 * this file only registers a trivial feature surface for the probes to hit:
 * one param-less tool, one static resource, one prompt. Listens on :7102/mcp.
 *
 * Run: npm run start:rc   (from ref-servers/, under Node 22)
 */
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { createServer } from "node:http";

const PORT = 7102;

const handler = createMcpHandler(() => {
  const server = new McpServer({ name: "mcp-ready-rc", version: "0.0.0" });

  server.registerTool(
    "echo",
    { description: "Returns a fixed greeting; a tools/list + tools/call fixture." },
    async () => ({ content: [{ type: "text", text: "echo" }] }),
  );

  server.registerResource(
    "readme",
    "mcpready://readme",
    { title: "Readme", mimeType: "text/plain" },
    async (uri) => ({ contents: [{ uri: uri.href, text: "hello from the RC reference server" }] }),
  );

  server.registerPrompt(
    "greeting",
    { description: "A trivial prompt fixture." },
    () => ({ messages: [{ role: "user", content: { type: "text", text: "hi" } }] }),
  );

  return server;
});

const nodeHandler = toNodeHandler(handler);

createServer((req, res) => {
  void nodeHandler(req, res);
}).listen(PORT, "127.0.0.1", () => {
  console.log(`[rc] MCP 2026-07-28 reference server on http://127.0.0.1:${PORT}/mcp`);
});
