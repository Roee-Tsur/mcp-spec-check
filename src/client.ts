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
    const rawBody = await res.text();
    let body: unknown;
    if ((res.headers.get("content-type") ?? "").includes("text/event-stream")) {
      body = parseSseJson(rawBody);
    } else {
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

/**
 * Extract the first SSE `data:` event payload from a raw body and JSON.parse it.
 * Streamable-HTTP servers commonly wrap the JSON-RPC response in an SSE stream:
 *
 *   event: message
 *   data: {"jsonrpc":"2.0",...}
 *
 * Multi-line `data:` fields within one event are joined with "\n" per the SSE
 * spec. Returns undefined when no parseable data event is present.
 */
export function parseSseJson(rawBody: string): unknown | undefined {
  const dataLines: string[] = [];
  for (const line of rawBody.split(/\r?\n/)) {
    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).replace(/^ /, ""));
    } else if (line === "" && dataLines.length > 0) {
      break; // blank line ends the first event that carried data
    }
  }
  if (dataLines.length === 0) return undefined;
  try {
    return JSON.parse(dataLines.join("\n"));
  } catch {
    return undefined;
  }
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
