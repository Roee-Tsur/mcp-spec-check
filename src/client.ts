/**
 * Minimal JSON-RPC-over-HTTP helper for black-box probing MCP servers.
 *
 * Two modes:
 *  - legacy:  pre-2026-07-28 style (initialize handshake, Mcp-Session-Id, no routing headers)
 *  - next:    2026-07-28 style (stateless, _meta identity, Mcp-Method / Mcp-Name routing headers)
 *
 * All header names, method names, and error codes live in ./spec.ts, verified
 * against the RC spec text — see that file for sources. `postJsonRpc` is the
 * transport primitive; `postNext` layers the 2026-07-28 request envelope on top
 * (built by the pure `buildNextRequest`, which the checks lean on).
 */
import { HEADERS, MCP_NAME_METHODS, META_KEYS, TARGET_PROTOCOL_VERSION } from "./spec.js";
import { CLIENT_INFO, USER_AGENT } from "./version.js";

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
        "user-agent": USER_AGENT,
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

/** Extract the `result` object from a JSON-RPC response body, if it is one. */
export function rpcResult(body: unknown): Record<string, unknown> | undefined {
  if (typeof body === "object" && body !== null && "result" in body) {
    const result = (body as { result: unknown }).result;
    if (typeof result === "object" && result !== null) return result as Record<string, unknown>;
  }
  return undefined;
}

/** Extract a JSON-RPC error message from a response body, if present. */
export function rpcErrorMessage(body: unknown): string | undefined {
  if (typeof body === "object" && body !== null && "error" in body) {
    const err = (body as { error: unknown }).error;
    if (typeof err === "object" && err !== null && "message" in err) {
      const msg = (err as { message: unknown }).message;
      if (typeof msg === "string") return msg;
    }
  }
  return undefined;
}

/**
 * True when a response is a pre-2026-07-28 server refusing a request because it
 * has no session / wasn't initialized — the signature of a stateful legacy
 * lifecycle. Keyed on the error message (the old SDK answers a session-less
 * request with HTTP 400 and "No valid session ID provided"). Modern 400s
 * (HeaderMismatch, UnsupportedProtocolVersion) don't mention sessions, so they
 * are not misread as legacy.
 */
export function isSessionRejection(httpStatus: number, body: unknown): boolean {
  const message = rpcErrorMessage(body);
  return message !== undefined && /session|not initialized/i.test(message);
}

export interface NextRequestOptions {
  /** Existing headers to merge in first (e.g. Authorization). */
  headers?: Record<string, string>;
  /**
   * Deliberately override or drop the computed routing headers, for probes that
   * test mismatch / absence behavior. A `null` value drops the header entirely;
   * a string replaces it. Keys must match the casing produced here (see HEADERS).
   */
  headerOverrides?: Record<string, string | null>;
  /** Protocol version to advertise; defaults to the 2026-07-28 target. */
  protocolVersion?: string;
}

export interface NextRequest {
  /** params with the required io.modelcontextprotocol/* _meta identity merged in. */
  params: Record<string, unknown>;
  /** Routing + protocol-version headers for the POST. */
  headers: Record<string, string>;
}

/**
 * Build the 2026-07-28 request envelope for a method: the required _meta
 * identity keys (protocolVersion / clientInfo / clientCapabilities) merged into
 * params, plus the MCP-Protocol-Version and Mcp-Method (and Mcp-Name where the
 * method requires it) routing headers. Pure and deterministic so checks can
 * unit-test their request shape without a network. Caller-supplied _meta keys
 * are preserved; headerOverrides let a probe force a mismatch or omission.
 */
export function buildNextRequest(
  method: string,
  params: Record<string, unknown> = {},
  opts: NextRequestOptions = {},
): NextRequest {
  const protocolVersion = opts.protocolVersion ?? TARGET_PROTOCOL_VERSION;

  const callerMeta =
    typeof params["_meta"] === "object" && params["_meta"] !== null
      ? (params["_meta"] as Record<string, unknown>)
      : {};
  const _meta: Record<string, unknown> = {
    [META_KEYS.protocolVersion]: protocolVersion,
    [META_KEYS.clientInfo]: CLIENT_INFO,
    [META_KEYS.clientCapabilities]: {},
    ...callerMeta,
  };
  const nextParams: Record<string, unknown> = { ...params, _meta };

  const headers: Record<string, string> = {
    ...opts.headers,
    [HEADERS.protocolVersion]: protocolVersion,
    [HEADERS.method]: method,
  };
  if (MCP_NAME_METHODS.has(method)) {
    const source =
      typeof params["name"] === "string"
        ? (params["name"] as string)
        : typeof params["uri"] === "string"
          ? (params["uri"] as string)
          : undefined;
    if (source !== undefined) headers[HEADERS.name] = source;
  }
  for (const [key, value] of Object.entries(opts.headerOverrides ?? {})) {
    if (value === null) delete headers[key];
    else headers[key] = value;
  }

  return { params: nextParams, headers };
}

/** POST a request in 2026-07-28 (next) mode: full _meta identity + routing headers. */
export async function postNext(
  url: string,
  method: string,
  params: Record<string, unknown> = {},
  opts: NextRequestOptions & { timeoutMs?: number } = {},
): Promise<RpcResponse> {
  const { params: nextParams, headers } = buildNextRequest(method, params, opts);
  return postJsonRpc(url, method, nextParams, { timeoutMs: opts.timeoutMs, headers });
}

export interface GetProbeResult {
  httpStatus: number;
  headers: Headers;
  contentType: string;
}

/**
 * Issue a bare GET and report the status + content-type WITHOUT reading the
 * body. The 2026-07-28 transport removes the GET endpoint (→ 405), whereas a
 * legacy server answers GET with a long-lived SSE stream that would hang a
 * body read — so the body is cancelled immediately.
 */
export async function getProbe(
  url: string,
  opts: { accept?: string; timeoutMs?: number; headers?: Record<string, string> } = {},
): Promise<GetProbeResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 15_000);
  try {
    const res = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      headers: { accept: opts.accept ?? "text/event-stream", "user-agent": USER_AGENT, ...opts.headers },
    });
    await res.body?.cancel().catch(() => {});
    return {
      httpStatus: res.status,
      headers: res.headers,
      contentType: res.headers.get("content-type") ?? "",
    };
  } finally {
    clearTimeout(timer);
  }
}

export interface JsonGetResult {
  httpStatus: number;
  headers: Headers;
  body: unknown;
}

/** GET a URL and parse a JSON body (undefined on non-JSON). For well-known metadata probes. */
export async function getJson(
  url: string,
  opts: { timeoutMs?: number; headers?: Record<string, string> } = {},
): Promise<JsonGetResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 15_000);
  try {
    const res = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      headers: { accept: "application/json", "user-agent": USER_AGENT, ...opts.headers },
    });
    const raw = await res.text();
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      body = undefined;
    }
    return { httpStatus: res.status, headers: res.headers, body };
  } finally {
    clearTimeout(timer);
  }
}
