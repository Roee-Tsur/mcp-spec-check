# mcp-ready

Zero-install CLI (`npx mcp-ready <url>`) that black-box-probes a remote MCP server and reports whether it's ready for the **MCP spec release of 2026-07-28**. Second deliverable: a scan of the public registry ("X% of public MCP servers aren't ready") published as a writeup.

## Commands

- `npm run dev <url>` — run the CLI from source (tsx)
- `npm run build` — compile to dist/
- `npm test` — vitest
- `npm run typecheck` — tsc --noEmit

**Dev-env gotcha:** this machine's default node is v10 via nvm. Run EVERYTHING under Node 22 (`export PATH="$HOME/.nvm/versions/node/v22.22.2/bin:$PATH"` or `nvm use 22`), including `npm install`. A v10-era install produces broken node_modules (rollup optional-deps bug).

## Architecture

- `src/index.ts` — CLI entry: arg parsing, check runner, exit codes (0 ready / 1 fail / 2 error)
- `src/client.ts` — JSON-RPC-over-HTTP probe helpers (legacy + new-spec request modes)
- `src/checks/*.ts` — one file per readiness check; each exports a `CheckDefinition`. Registered in `checks/index.ts`
- `src/report.ts` — grading (A–F over decided checks; warn = half credit), terminal + JSON rendering
- `test/` — vitest unit tests (pure functions only; probe logic is tested against live reference servers, see below)

## Critical rules

1. **Verify spec details before implementing any probe.** The scaffold's header names, method names, and error codes were written from summaries and are marked `TODO(verify)`. The sources of truth are the RC spec (https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/, the spec repo) and the SEPs behind each change: SEP-2567 (sessions removed), SEP-2575 (initialize removed), SEP-2243 (routing headers), SEP-2549 (caching metadata). A false "not ready" verdict against a well-known server destroys the credibility this project exists to build.
2. **Test every check against reference servers before trusting it** — at least one old-spec server (expected: fails) and one new-spec/RC server (expected: passes). The official TypeScript SDK betas (https://blog.modelcontextprotocol.io/posts/sdk-betas-2026-07-28/) can run both.
3. **Zero runtime dependencies.** devDependencies only. This is a deliberate positioning choice for a probe tool.
4. **Checks must never throw for "server is broken"** — that's a `fail` result. Throwing is reserved for probe bugs (`error`) and unimplemented checks (`NotImplementedError` → `todo`).
5. **Optional spec features are `warn`, never `fail`** (e.g. cache metadata, deprecated-feature usage).
6. **Registry scan publishes aggregates only** — no named shame-list of servers/maintainers.
7. Grades over partially-implemented check suites must be labeled partial (report.ts already does this).
8. **Never claim servers "break on July 28."** The official position is "nothing breaks on July 28" — it's the spec-text publication date, not a switch-off; version negotiation continues and deprecated features live ≥12 months. All copy (README, CLI output, scan writeup) frames results as readiness/adoption, never breakage-on-a-date.
9. **Auth walls are not failures.** 401/403 → preflight access `auth-required`; checks report `skipped`; exit code 2. The registry scan must publish denominators (open / auth-walled / unreachable / not-mcp) and compute percentages only over probeable servers.

## Conventions

- TypeScript strict, ESM (NodeNext), Node ≥20 (uses global fetch)
- Conventional commits (`feat:`, `fix:`, `docs:`, `chore:`)
- Every check file documents its probe plan in comments before implementation

## Current state

Scaffold only. `discover` check is semi-implemented (needs spec verification); the other six throw `NotImplementedError`. Plumbing (runner, grading, rendering, exit codes) works end-to-end and is unit-tested.
