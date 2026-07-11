# mcp-ready

> Will your remote MCP server break on the **2026-07-28 spec release**? Find out in 30 seconds.

```bash
npx mcp-ready https://your-server.com/mcp
```

**Status: pre-release, under active development.** Probes are being verified against reference implementations before v0.1.0.

The [MCP 2026-07-28 release](https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/) is a breaking change: the `initialize` handshake and `Mcp-Session-Id` are removed, `Mcp-Method`/`Mcp-Name` routing headers become required, SSE elicitation is replaced by Multi Round-Trip Requests, and error codes change. `mcp-ready` black-box-probes your live endpoint — no code access needed — and tells you exactly what will break, with links to the migration docs.

## What it checks

| Check | What breaks if you fail it |
| --- | --- |
| `discover` | `server/discover` replaces the initialize handshake |
| `session-independence` | Protocol-level sessions are removed; session-pinned servers break behind load balancers |
| `routing-headers` | `Mcp-Method` / `Mcp-Name` are required on every request |
| `error-codes` | `-32002` is retired in favor of `-32602` |
| `mrtr` | SSE elicitation is replaced by `InputRequiredResult` + `requestState` |
| `cache-metadata` | (warn) new `ttlMs` / `cacheScope` metadata on tool results |
| `deprecated-features` | (warn) Roots / Sampling / Logging enter deprecation |

## Usage

```bash
npx mcp-ready <url>              # human-readable report + letter grade
npx mcp-ready <url> --json       # machine-readable, for scripting
npx mcp-ready <url> --verbose    # include the "why" for each check
```

### CI

Exit codes are CI-friendly: `0` ready · `1` at least one failing check · `2` probe error.

```yaml
- run: npx mcp-ready ${{ env.MCP_SERVER_URL }}
```

## How it works

Pure black-box HTTP probes against your live endpoint. No code access, nothing installed, nothing stored. Zero runtime dependencies.

## Contributing

Issues and PRs welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). If the tool gives your server a wrong verdict, please open an issue with the `--json` output; probe correctness is the top priority.

## License

MIT
