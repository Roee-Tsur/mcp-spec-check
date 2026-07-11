# mcp-spec-check

Zero-install CLI (`npx mcp-spec-check <url>`) that black-box-probes a remote MCP server and reports whether it's ready for the **MCP spec release of 2026-07-28**. Second deliverable: a scan of the public registry ("X% of public MCP servers aren't ready") published as a writeup.

## Commands

- `npm run dev <url>` — run the CLI from source (tsx)
- `npm run build` — compile to dist/
- `npm test` — vitest
- `npm run typecheck` — tsc --noEmit

Requires Node ≥20 (uses global fetch); develop and install under Node 22.

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

Premise verified against live sources 2026-07-11 (RC blog post, SDK-betas post, registry API). Plumbing implemented and unit-tested end-to-end: runner, grading, rendering, exit codes, preflight classification, `--bearer`/`--header`, `skipped` status, SSE unwrapping.

**Milestone 1 (Probe core) complete — 2026-07-11.** All 8 checks implemented and verified against both reference servers:
- Verified spec facts centralized in `src/spec.ts` (protocol version, `_meta` keys, header names, both error-code generations, per-check `FIX_URLS`); authoritative source is `/specification/draft/changelog` (SEP pages are stale on the renumbered error codes). No `TODO(verify)` markers remain.
- `src/client.ts` gained the next-mode envelope (`buildNextRequest` pure + `postNext`) and GET helpers (`getProbe`, `getJson`); `src/probe-transport.ts` (`acquireTransport`) gives checks a working request mode on both stateless-RC and stateful-legacy servers.
- Reference servers in `ref-servers/` (own pinned package.json — root stays zero-dep): `old-server.ts` (SDK v1 1.21.0, stateful, :7101) and `rc-server.ts` (`@modelcontextprotocol/server`+`/node` beta, :7102). `npm run refs:old` / `refs:rc`.
- **`npm run verify:refs`** is the live oracle: asserts the full per-check verdict matrix + grade + exit code for RC (A/0), old (F/1), and an inline auth-walled fixture (?/2). Kept out of `npm test` (which stays offline), but runs in CI as a dedicated `verify-refs` job that installs `ref-servers/` deps first (`.github/workflows/ci.yml`). `npm run verify:conformance` runs the official suite (`@alpha`) against the RC fixture as a co-oracle (manual only — it network-fetches an alpha package).
- Notable finding: SDK 1.21.0 already emits the renumbered `-32602` for resource-not-found, so `error-codes` passes recent old-spec servers too — it only catches genuinely old error tables. `cache-metadata`/`mrtr`/`deprecated-features` are warn-only. `auth-metadata` runs through auth walls (`runsWhenAuthWalled`) and `grade()` stays `?` below `MIN_DECIDED_FOR_GRADE` (3).

**Milestone 2 (Ship the CLI) DONE — 2026-07-11. Published: `mcp-spec-check@0.1.0` on npm (with provenance).** `src/version.ts` centralizes `VERSION`/`CLIENT_INFO` (read from package.json, so `npm version` propagates); README finalized (honest checks table, badges, no pre-release banner); `verify-refs` runs in CI. Repo public at `Roee-Tsur/mcp-spec-check`.

- **Renamed from `mcp-ready` → `mcp-spec-check`**: npm's anti-typosquat filter blocked `mcp-ready` as too similar to the existing `mcpready` (a competing readiness tool by Codixus, published 2026-07-04, ~370 wk downloads; `mcp-readiness` also exists, ~414). The GitHub repo, package/bin, clientInfo identity, and all copy were renamed. **Watch these competitors** (was PLAN.md's open question).
- Release flow: `NPM_TOKEN` is a **Production-environment** secret (2FA-bypass granular token, "All packages" scope), so release.yml's publish job declares `environment: Production`. Tag push `v*` → build/test → `npm publish --provenance`. To cut a release: `npm version minor|patch` on green main → `git push --follow-tags`.
- Cold-tested: `npx mcp-spec-check@0.1.0 --version` and a full probe of the RC ref server (grade A / exit 0) from a fresh cache outside the repo. **Still TODO:** `--bearer`/`--header` cold test against a real authed server (needs a user-supplied token, e.g. GitHub MCP `https://api.githubcopilot.com/mcp/`).
- `PLAN.md` is now **git-ignored** (local-only strategy notes) and was purged from pushed history via filter-branch + force-push. Note: old commit SHAs may linger as dangling objects on GitHub until its own GC.
