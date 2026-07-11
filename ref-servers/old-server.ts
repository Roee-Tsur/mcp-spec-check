/**
 * Old-spec reference server — speaks MCP 2025-11-25 via the v1 TypeScript SDK
 * (@modelcontextprotocol/sdk), in STATEFUL mode. The NEGATIVE fixture: it
 * requires the legacy initialize handshake and mints an Mcp-Session-Id, so the
 * readiness checks should fail it (no server/discover, session-bound, ignores
 * routing headers, legacy error codes).
 *
 * Stateful on purpose: a new transport is created per initialize and keyed by
 * session id (the canonical v1 pattern). A next-mode request that arrives with
 * no session and isn't an initialize is rejected 400 — exactly the pre-2026
 * lifecycle the session-independence and discover checks look for.
 *
 * It also declares the `logging` and `resources.subscribe` capabilities so the
 * deprecated-features check has something to warn about.
 *
 * Listens on :7101/mcp. Run: npm run start:old   (from ref-servers/, Node 22)
 */
import express, { type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";

const PORT = 7101;

function buildServer(): McpServer {
  const server = new McpServer(
    { name: "mcp-ready-old", version: "0.0.0" },
    { capabilities: { logging: {}, resources: { subscribe: true } } },
  );

  server.tool("echo", "Returns a fixed greeting; a tools/list + tools/call fixture.", async () => ({
    content: [{ type: "text", text: "echo" }],
  }));

  server.registerResource(
    "readme",
    "mcpready://readme",
    { title: "Readme", mimeType: "text/plain" },
    async (uri) => ({ contents: [{ uri: uri.href, text: "hello from the old reference server" }] }),
  );

  return server;
}

const app = express();
app.use(express.json());

const transports: Record<string, StreamableHTTPServerTransport> = {};

app.post("/mcp", async (req: Request, res: Response) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  let transport = sessionId ? transports[sessionId] : undefined;

  if (!transport) {
    if (!sessionId && isInitializeRequest(req.body)) {
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sid) => {
          transports[sid] = transport!;
        },
      });
      transport.onclose = () => {
        if (transport!.sessionId) delete transports[transport!.sessionId];
      };
      await buildServer().connect(transport);
    } else {
      res.status(400).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Bad Request: No valid session ID provided" },
        id: null,
      });
      return;
    }
  }

  await transport.handleRequest(req, res, req.body);
});

async function sessionRequest(req: Request, res: Response): Promise<void> {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  const transport = sessionId ? transports[sessionId] : undefined;
  if (!transport) {
    res.status(400).send("Invalid or missing session ID");
    return;
  }
  await transport.handleRequest(req, res);
}

app.get("/mcp", sessionRequest);
app.delete("/mcp", sessionRequest);

app.listen(PORT, "127.0.0.1", () => {
  console.log(`[old] MCP 2025-11-25 reference server on http://127.0.0.1:${PORT}/mcp`);
});
