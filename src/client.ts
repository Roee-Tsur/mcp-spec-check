/**
 * Minimal JSON-RPC-over-HTTP helper for black-box probing MCP servers.
 *
 * Two modes:
 *  - legacy:  pre-2026-07-28 style (initialize handshake, Mcp-Session-Id, no routing headers)
 *  - next:    2026-07-28 style (stateless, Mcp-Method / Mcp-Name routing headers)
 *
 * !! IMPORTANT (Claude Code): before implementing checks, re-verify every header
 * !! name, method name, and error code against the RC spec text:
 * !! https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/
 * !! Do NOT trust the names in this scaffold — they were written from a summary.
 */

export interface RpcResponse {
  httpStatus: number;
  headers: Headers;
  /** Parsed JSON body, or undefined if the body wasn't JSON. */
  body: unknown;
  rawBody: string;
}

export interface RpcOptions {
  timeoutMs?: number;
  /** Extra HTTP headers (e.g. Mcp-Method, Mcp-Name, Mcp-Session-Id). */
  headers?: Record<string, string>;
}

let nextId = 1;

export async function postJsonRpc(
  url: string,
  method: string,
  params: unknown,
  opts: RpcOptions = {},
): Promise<RpcResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 15_000);
  try {
    const res = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...opts.headers,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }),
    });
    let rawBody: string;
    let body: unknown;
    if ((res.headers.get("content-type") ?? "").includes("text/event-stream")) {
      // Read incrementally and stop at the first JSON-RPC response event:
      // servers may hold the SSE stream open (keepalives) after answering,
      // and awaiting the full body would hang until the timeout fires.
      rawBody = res.body ? await readSseUntilResponse(res.body) : await res.text();
      body = parseSseJson(rawBody);
    } else {
      rawBody = await res.text();
      try {
        body = JSON.parse(rawBody);
      } catch {
        body = undefined;
      }
    }
    return { httpStatus: res.status, headers: res.headers, body, rawBody };
  } finally {
    clearTimeout(timer);
  }
}

/** A JSON-RPC response envelope (result or error) — as opposed to a notification. */
export function isJsonRpcResponse(body: unknown): body is Record<string, unknown> {
  return (
    typeof body === "object" &&
    body !== null &&
    (body as { jsonrpc?: unknown }).jsonrpc === "2.0" &&
    ("result" in body || "error" in body)
  );
}

/**
 * Parse every SSE event's `data:` payload as JSON. Multi-line `data:` fields
 * within one event are joined with "\n" per the SSE spec; unparseable payloads
 * are dropped. `includeTrailing` also parses a final event that wasn't yet
 * terminated by a blank line (needed while a stream is still in flight, where
 * the last event may be incomplete).
 */
function parseSseEvents(rawBody: string, includeTrailing: boolean): unknown[] {
  const blocks = rawBody.split(/\r?\n\r?\n/);
  const complete = includeTrailing ? blocks : blocks.slice(0, -1);
  const payloads: unknown[] = [];
  for (const block of complete) {
    const dataLines: string[] = [];
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /, ""));
    }
    if (dataLines.length === 0) continue;
    try {
      payloads.push(JSON.parse(dataLines.join("\n")));
    } catch {
      // not JSON (e.g. keepalive text) — skip
    }
  }
  return payloads;
}

/**
 * Extract the JSON-RPC payload from an SSE-wrapped body. Streamable-HTTP
 * servers commonly deliver the JSON-RPC response as an SSE stream:
 *
 *   event: message
 *   data: {"jsonrpc":"2.0",...}
 *
 * The stream may carry notifications (e.g. logging) BEFORE the response, so
 * prefer the first event that is a JSON-RPC response (result/error); fall back
 * to the first parseable payload. Returns undefined when neither exists.
 */
export function parseSseJson(rawBody: string): unknown | undefined {
  const payloads = parseSseEvents(rawBody, true);
  return payloads.find(isJsonRpcResponse) ?? payloads[0];
}

/**
 * Consume an SSE body only until a complete event carrying a JSON-RPC response
 * has arrived, then cancel the stream. Only blank-line-terminated events are
 * considered while streaming, so a response split across chunks can't be
 * truncated. Returns the raw text consumed.
 */
async function readSseUntilResponse(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      if (parseSseEvents(buf, false).some(isJsonRpcResponse)) break;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return buf;
}

/** Extract a JSON-RPC error code from a response body, if present. */
export function rpcErrorCode(body: unknown): number | undefined {
  if (typeof body === "object" && body !== null && "error" in body) {
    const err = (body as { error: unknown }).error;
    if (typeof err === "object" && err !== null && "code" in err) {
      const code = (err as { code: unknown }).code;
      if (typeof code === "number") return code;
    }
  }
  return undefined;
}
