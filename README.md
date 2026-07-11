# mcp-ready

[![npm](https://img.shields.io/npm/v/mcp-ready)](https://www.npmjs.com/package/mcp-ready)
[![CI](https://github.com/Roee-Tsur/mcp-ready/actions/workflows/ci.yml/badge.svg)](https://github.com/Roee-Tsur/mcp-ready/actions/workflows/ci.yml)

> Is your remote MCP server ready for the **2026-07-28 MCP spec release**? Find out in 30 seconds.

```bash
npx mcp-ready https://your-server.com/mcp
```

The [MCP 2026-07-28 release](https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/) is the largest revision of the protocol since launch: the `initialize` handshake and `Mcp-Session-Id` are removed in favor of a stateless core, `Mcp-Method`/`Mcp-Name` routing headers become required, SSE elicitation is replaced by Multi Round-Trip Requests, and error codes change. **Nothing switches off on July 28 itself** — the spec text publishes that day and old protocol versions keep negotiating — but SDKs and clients are moving to the stateless core, and servers that never migrate will be left behind as support windows expire. `mcp-ready` black-box-probes your live endpoint — no code access needed — and tells you exactly where you stand, with links to the migration docs.

## What it checks

Only the first three can fail a server; the rest are `warn` — optional or forward-looking, never counted as "not ready" on their own.

| Check | What it means |
| --- | --- |
| `discover` | `server/discover` replaces the initialize handshake; servers must implement it |
| `routing-headers` | `Mcp-Method` / `Mcp-Name` are required on every request so gateways can route |
| `session-independence` | Protocol-level sessions are removed; session-pinned servers break behind load balancers |
| `error-codes` | (warn) resource-not-found renumbers from `-32002` to `-32602` |
| `cache-metadata` | (warn) new `ttlMs` / `cacheScope` caching metadata on list/read results |
| `mrtr` | (warn) results carry a `resultType` field (Multi Round-Trip Requests replace SSE elicitation) |
| `deprecated-features` | (warn) reliance on deprecated Logging or removed `resources/subscribe` capabilities |
| `auth-metadata` | (warn) OAuth protected-resource metadata (RFC 9728) discoverable at `/.well-known/oauth-protected-resource` |

## Usage

```bash
npx mcp-ready <url>                 # human-readable report + letter grade
npx mcp-ready <url> --json          # machine-readable, for scripting
npx mcp-ready <url> --verbose       # include the "why" for each check
npx mcp-ready <url> --timeout 30000 # per-probe timeout in ms (default 15000)
```

### Authenticated servers

```bash
npx mcp-ready <url> --bearer <token>          # sends Authorization: Bearer <token>
npx mcp-ready <url> --header "X-Api-Key: k"   # any header; repeatable
```

Without credentials, `mcp-ready` can classify an auth-walled server but can't
grade it — checks report `skipped` and the exit code is 2 (couldn't test). The
`auth-metadata` check still runs: its RFC 9728 probe of
`/.well-known/oauth-protected-resource` is origin-level and needs no token, so
you get a readiness signal even behind the wall.

### CI

Exit codes are CI-friendly: `0` ready · `1` at least one failing check · `2` couldn't test (probe error, or endpoint auth-walled / unreachable / not MCP).

```yaml
- run: npx mcp-ready ${{ env.MCP_SERVER_URL }}
```

## How it works

Pure black-box HTTP probes against your live endpoint. No code access, nothing installed, nothing stored. Zero runtime dependencies.

## How this compares

The official [conformance suite](https://github.com/modelcontextprotocol/conformance) is a spec test framework for implementers (including draft-spec scenarios) — you wire it up against your own code. [YawLabs/mcp-compliance](https://github.com/YawLabs/mcp-compliance) grades A–F compliance against the *current* 2025-11-25 spec. The official Inspector is for interactive debugging. `mcp-ready` is none of those: it's a 30-second black-box verdict on a hosted URL, aimed specifically at the *next* release (2026-07-28).

## Contributing

Issues and PRs welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). If the tool gives your server a wrong verdict, please open an issue with the `--json` output; probe correctness is the top priority.

## License

MIT
