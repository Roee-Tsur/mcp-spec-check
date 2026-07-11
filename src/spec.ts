/**
 * Verified constants for the MCP 2026-07-28 spec release.
 *
 * Single source of truth for every header name, method name, _meta key, and
 * error code the checks rely on. Each value is annotated with the primary
 * source it was verified against and the date of verification, so a future
 * reader can re-check it against the spec rather than trusting this file.
 *
 * Verified 2026-07-11 against:
 *  - changelog:  https://modelcontextprotocol.io/specification/draft/changelog
 *  - transport:  https://modelcontextprotocol.io/specification/draft/basic/transports/streamable-http
 *  - caching:    https://modelcontextprotocol.io/specification/draft/server/utilities/caching
 *
 * The changelog is authoritative where an individual SEP page disagrees (the
 * SEP pages are stale on the renumbered error codes). The dated
 * /specification/2026-07-28 URLs 404 until GA — every fixUrl below points at
 * /draft or a stable /seps page for now; re-point at dated URLs post-GA.
 */

/**
 * Protocol version string for the release, sent in both the
 * MCP-Protocol-Version header and the _meta protocolVersion field. They MUST
 * match or the server rejects with HeaderMismatch (-32020).
 * Source: transport spec, "Protocol Version Header" — `MCP-Protocol-Version: 2026-07-28`.
 */
export const TARGET_PROTOCOL_VERSION = "2026-07-28";

/** The prior release, spoken by the legacy `initialize` preflight. */
export const LEGACY_PROTOCOL_VERSION = "2025-11-25";

/**
 * Required _meta keys on every request body (SEP-2575). Namespaced under
 * io.modelcontextprotocol/. Verified against the transport spec's worked
 * request examples.
 */
export const META_KEYS = {
  protocolVersion: "io.modelcontextprotocol/protocolVersion",
  clientInfo: "io.modelcontextprotocol/clientInfo",
  clientCapabilities: "io.modelcontextprotocol/clientCapabilities",
} as const;

/**
 * HTTP headers that mirror body fields for gateway routing (SEP-2243).
 * Names are case-insensitive per RFC 9110; values are case-sensitive.
 *  - MCP-Protocol-Version: every POST, MUST equal _meta protocolVersion
 *  - Mcp-Method:           every request, MUST equal `method`
 *  - Mcp-Name:             tools/call, resources/read, prompts/get — equals params.name or params.uri
 */
export const HEADERS = {
  protocolVersion: "MCP-Protocol-Version",
  method: "Mcp-Method",
  name: "Mcp-Name",
} as const;

/** Methods that require the Mcp-Name routing header (value = params.name or params.uri). */
export const MCP_NAME_METHODS = new Set(["tools/call", "resources/read", "prompts/get"]);

/**
 * JSON-RPC error codes. The 2026-07-28 draft renumbered its own codes under a
 * new allocation policy: -32000..-32019 stays implementation-defined
 * (grandfathered), -32020..-32099 is reserved for the MCP spec. Both the new
 * and legacy numbers are kept so checks can tolerate the old codes during the
 * beta window (SDKs mid-migration may still emit them).
 * Source: changelog "error code allocation policy" + transport "Server Validation".
 */
export const ERROR = {
  /** JSON-RPC standard: method not found. Unknown RPC also returns HTTP 404. */
  methodNotFound: -32601,
  /** JSON-RPC standard: invalid params. Resource-not-found renumbered here (was -32002). */
  invalidParams: -32602,
  /** Legacy resource-not-found, renumbered to -32602 in the draft. */
  legacyResourceNotFound: -32002,
  /** Header/body mismatch or missing required header. Was -32001 in the SEP prose. */
  headerMismatch: -32020,
  legacyHeaderMismatch: -32001,
  /** Missing required client capability. Was -32003. */
  missingRequiredClientCapability: -32021,
  legacyMissingRequiredClientCapability: -32003,
  /** Unsupported protocol version. Was -32004. */
  unsupportedProtocolVersion: -32022,
  legacyUnsupportedProtocolVersion: -32004,
} as const;

/**
 * Results carrying cache metadata (SEP-2549, CacheableResult). ttlMs +
 * cacheScope are REQUIRED on each in the RC; mcp-ready treats their absence as
 * a warn during the beta window (see cache-metadata check).
 */
export const CACHEABLE_METHODS = new Set([
  "tools/list",
  "prompts/list",
  "resources/list",
  "resources/read",
  "resources/templates/list",
]);

export const CACHE_SCOPES = new Set(["public", "private"]);

/** resultType field on every result (SEP-2322 / MRTR). */
export const RESULT_TYPES = { complete: "complete", inputRequired: "input_required" } as const;

/**
 * Server capabilities that are deprecated or removed in 2026-07-28, keyed by
 * the capability path a server would declare. Used by the deprecated-features
 * check. `logging` is deprecated (SEP-2577); `resources.subscribe` is removed
 * (subscriptions/listen replaces resources/subscribe, SEP-2575).
 */
export const DEPRECATED_CAPABILITIES: Array<{ path: string; note: string }> = [
  { path: "logging", note: "Logging is deprecated (SEP-2577)" },
  {
    path: "resources.subscribe",
    note: "resources/subscribe is removed; use subscriptions/listen (SEP-2575)",
  },
];

/** Per-check migration links. Verified non-404 on 2026-07-11. */
export const FIX_URLS = {
  discover: "https://modelcontextprotocol.io/seps/2575-stateless-mcp",
  sessionIndependence: "https://modelcontextprotocol.io/seps/2567-sessionless-mcp",
  routingHeaders: "https://modelcontextprotocol.io/seps/2243-http-standardization",
  errorCodes: "https://modelcontextprotocol.io/specification/draft/changelog",
  deprecatedFeatures: "https://modelcontextprotocol.io/specification/draft/deprecated",
  cacheMetadata: "https://modelcontextprotocol.io/specification/draft/server/utilities/caching",
  mrtr: "https://modelcontextprotocol.io/specification/draft/basic/patterns/mrtr",
  authMetadata: "https://modelcontextprotocol.io/specification/draft/basic/authorization",
} as const;
