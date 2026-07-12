# mcp-spec-check

[![npm](https://img.shields.io/npm/v/mcp-spec-check)](https://www.npmjs.com/package/mcp-spec-check)
[![CI](https://github.com/Roee-Tsur/mcp-spec-check/actions/workflows/ci.yml/badge.svg)](https://github.com/Roee-Tsur/mcp-spec-check/actions/workflows/ci.yml)

> Is your remote MCP server ready for the **2026-07-28 MCP spec release**? Find out in 30 seconds.

```bash
npx mcp-spec-check https://your-server.com/mcp
```

> **Nothing breaks on July 28.** That date is when the spec text publishes, not a switch that flips. Version negotiation keeps working and deprecated features live for at least 12 months. This tool measures *adoption* of the new stateless core, not a countdown to an outage.

The [MCP 2026-07-28 release](https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/) is the largest revision of the protocol since launch. The `initialize` handshake and `Mcp-Session-Id` are removed in favor of a stateless core, `Mcp-Method` / `Mcp-Name` routing headers become required, SSE elicitation is replaced by Multi Round-Trip Requests, and several error codes change. SDKs and clients are already moving to the stateless core, so servers that never migrate get left behind as support windows expire. `mcp-spec-check` black-box-probes your live endpoint (no code access needed) and tells you where you stand, with links to the migration docs.

## The ecosystem scan

I probed every remote server in the official MCP registry, all 7,850 of them, on 2026-07-12. Of the 4,356 I could reach openly, exactly 1 passes all three required checks and 90.8% are not ready yet. The migration to the stateless core has barely begun, which is what you would expect before the spec is even GA. Full writeup, with every percentage next to its denominator and a host-collapsed sensitivity view: **[docs/scan-2026-07.md](docs/scan-2026-07.md)** (committed aggregate: [scan-2026-07.aggregates.json](docs/scan-2026-07.aggregates.json)).

## What it checks

The report leads with a one-line verdict, **`ready for 2026-07-28: YES / NO / UNKNOWN`**, decided *only* by the three required checks below (`discover`, `routing-headers`, `session-independence`): all three pass gives `YES`, any fail gives `NO`, otherwise `UNKNOWN`. A letter grade over every check follows as a secondary signal.

Only those first three can fail a server. The rest are `warn`: optional or forward-looking, never counted as "not ready" on their own.

A check the server answers too ambiguously to judge is marked `inconclusive` and, like a skipped check, does not count toward the grade. If too many land there, the tool reports grade `?` ("couldn't assess", exit 2) rather than guess.

| Check | What it means |
| --- | --- |
| `discover` | `server/discover` replaces the initialize handshake; servers must implement it |
| `routing-headers` | `Mcp-Method` / `Mcp-Name` are required on every request so gateways can route |
| `session-independence` | Protocol-level sessions are removed; session-pinned servers cannot serve the stateless core behind load balancers |
| `error-codes` | (warn) resource-not-found renumbers from `-32002` to `-32602` |
| `cache-metadata` | (warn) new `ttlMs` / `cacheScope` caching metadata on list/read results |
| `mrtr` | (warn) results carry a `resultType` field (Multi Round-Trip Requests replace SSE elicitation) |
| `deprecated-features` | (warn) reliance on deprecated Logging or removed `resources/subscribe` capabilities |
| `auth-metadata` | (warn) OAuth protected-resource metadata (RFC 9728) discoverable at `/.well-known/oauth-protected-resource` |

## How the verdicts are validated

Probe correctness is the whole game, so every check is pinned against known-truth servers rather than just asserted:

- **Two reference servers run in CI.** A real old-spec server (official SDK v1) and an RC server (the 2026-07-28 SDK beta) are spawned on every build, and `mcp-spec-check` must produce the exact expected verdict for all eight checks against both (`npm run verify:refs`). A regression in either direction fails the build.
- **A known-truth panel** cross-checks live public servers whose behavior is established, including GitHub's MCP server (auth-walled, RFC 9728 passes) and servers that should read as not-ready or inconclusive.
- **The official [conformance suite](https://github.com/modelcontextprotocol/conformance)** runs against the RC reference server as an independent co-oracle.

If the tool ever gives your server a wrong verdict, that is the top-priority bug. Open an issue with the `--json` output.

## Usage

```bash
npx mcp-spec-check <url>                 # human-readable report + letter grade
npx mcp-spec-check <url> --json          # machine-readable, for scripting
npx mcp-spec-check <url> --verbose       # include the "why" for each check
npx mcp-spec-check <url> --timeout 30000 # per-probe timeout in ms (default 15000)
```

### Authenticated servers

```bash
npx mcp-spec-check <url> --bearer <token>          # sends Authorization: Bearer <token>
npx mcp-spec-check <url> --header "X-Api-Key: k"   # any header; repeatable
```

Without credentials, `mcp-spec-check` can classify an auth-walled server but cannot
grade it: checks report `skipped` and the exit code is 2 (couldn't test). The
`auth-metadata` check still runs, because its RFC 9728 probe of
`/.well-known/oauth-protected-resource` is origin-level and needs no token, so
you get a readiness signal even behind the wall.

### CI

Exit codes are CI-friendly: `0` ready, `1` at least one failing check, `2` couldn't test (probe error; endpoint auth-walled / unreachable / not MCP; or the server answered our probes too ambiguously to grade).

```yaml
- run: npx mcp-spec-check ${{ env.MCP_SERVER_URL }}
```

## How it works

Pure black-box HTTP probes against your live endpoint. No code access, nothing installed, nothing stored. Zero runtime dependencies.

**Probing ethics.** The registry scan only touches endpoints voluntarily published in the official public MCP registry as connect URLs. Probes are host-serial (one request at a time per host, so no server ever sees parallel load), read-only protocol calls with no side effects, sent with a named `mcp-spec-check-scan` User-Agent that links back to this repo. Per-server results stay on the machine that ran the scan; only aggregate counts and percentages are published.

## How this compares

The official [conformance suite](https://github.com/modelcontextprotocol/conformance) is a spec test framework for implementers, including draft-spec scenarios, that you wire up against your own code. [YawLabs/mcp-compliance](https://github.com/YawLabs/mcp-compliance) grades A to F compliance against the *current* 2025-11-25 spec. The official Inspector is for interactive debugging. `mcp-spec-check` is none of those: it is a 30-second black-box verdict on a hosted URL, aimed specifically at the *next* release (2026-07-28).

## Contributing

Issues and PRs welcome, see [CONTRIBUTING.md](CONTRIBUTING.md). Probe correctness is the top priority: if a verdict looks wrong, please include the `--json` output.

## License

MIT
