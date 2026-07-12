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
- Cold-tested from a fresh cache outside the repo: `--version`, a full RC-ref probe (A/0), and the `--bearer`/`--header` auth path against **GitHub MCP** (`https://api.githubcopilot.com/mcp/`, token from the local `gh` login) — no token → auth-required/exit 2 with `auth-metadata` still passing; `--bearer` → all checks run, **grade A / exit 0** with one warn (GitHub omits `resultType`).
- `PLAN.md` is now **git-ignored** (local-only strategy notes) and was purged from pushed history via filter-branch + force-push. Note: old commit SHAs may linger as dangling objects on GitHub until its own GC.

**Grading refinement (`inconclusive` status) — 2026-07-11, shipped in v0.1.1.** Live-probing surfaced that `warn` was overloaded: it meant both "optional feature genuinely absent" (decided, half credit) and "the probe couldn't get a clean signal" (undecided). DeepWiki (answers legacy `initialize` but `-32600`s every 2026-07-28 probe) produced 6 "couldn't confirm" warns → grade D / exit 0, i.e. a misleading "≈57% ready, CI-pass" for a server we couldn't assess.
- Added a distinct **`inconclusive`** `CheckStatus` (`src/types.ts`). Like `skipped`, it's excluded from `grade()`'s decided set; `MIN_DECIDED_FOR_GRADE` stays 3. `exitCode()` now returns **2** when an `open` endpoint grades `?`. So DeepWiki now reads `?`/exit 2.
- The "couldn't confirm / couldn't run / no result to inspect / transport-none" branches across the checks emit `inconclusive`; genuine optional-absent observations (missing cache metadata/`resultType`, deprecated caps, the routing wrong-code case) stay `warn`.
- `verify:refs` gained a 4th scenario — an inline `-32600` "ambiguous server" fixture (port 7104) reproducing DeepWiki (`?`/exit 2, 6 checks inconclusive). RC/old/auth matrices unchanged. Regression-checked live: GitHub still A/0, HuggingFace still D/1 (clean fails, 0 inconclusive).
- **Open M3 question (still unresolved):** whether the `warn = 0.5` weight for genuinely-absent *optional* features should dock the grade at all (the "fully-migrated server caps at 7/8 = B" concern). Separate from this change.

**Milestone 3 (Registry scan) — Phases A/B/C-tooling done, 2026-07-12; D drafted; live full-run + release still pending.**
- **Phase A (src → library):** `src/probe.ts` `probeServer(ctx): Report` (no argv/console/exit; the CLI and the scan run identical code). `probe-transport.ts` `getTransport(ctx)` memoizes one transport per probe (`ctx.transport`), so the 4 transport-checks share one legacy session — verify:refs old matrix confirmed unchanged. `report.ts` gained `REQUIRED_CHECK_IDS` + `readiness()` (ready/not-ready/unknown over the required-3, **decoupled from the letter grade**) + a terminal `ready for 2026-07-28: YES/NO/UNKNOWN` line; `grade()` weights untouched (the open question above is deferred, not resolved). `types.ts` additive: `CheckResult.data`, `Report.readiness`/`protocol`, `ProbeContext.transport`. `discover` surfaces `data.supportedVersions`. Default `User-Agent: mcp-spec-check/<v> (+repo)` on every fetch (`client.ts`/`version.ts`). verify:refs asserts `readiness` for all 4 scenarios.
- **Phase B (`scan/`, tsx-run, zero new deps, all output gitignored under `scan-results/`):** `registry.ts` (pure: active+latest filter, remote flatten, `isJunkUrl`, `normalizeUrl`+dedup, funnel). `fetch-registry.ts` (paginate `?limit=100&version=latest` + retry/backoff + scan UA). `probe-all.ts` (host-keyed serial queues under a global pool — gateways never parallel-probed; 10s/probe + 120s/target budget; atomic resumable per-URL envelopes; one retry pass). `aggregate.ts` (pure `aggregate()` + `renderSummaryMd(agg)` which takes **only** Aggregates so nothing identifying leaks — rules 6/9; both endpoint-level and host-collapsed for every headline; publication-halting tripwires). `panel.ts` (known-truth sanity). `tsconfig.scan.json` + `typecheck:scan` (in CI). Scripts: `scan:fetch|probe|aggregate|scan|scan:panel`.
- **Live-validated 2026-07-12:** fetched **16,174 entries → 7,847 unique targets / 5,546 hosts** (135 junk); 25-target smoke probed + aggregated clean. `scan:panel` green across all 5 (ref RC/old, GitHub auth-walled + RFC 9728 pass, DeepWiki open/`unknown`, HF open/not-ready). **Bug caught + fixed in the smoke:** a `-32600` ambiguous server is transport-labelled `next` but never serves a result, so `newestDemonstratedVersion` must NOT credit it as 2026-07-28 — the target bucket now requires discover-pass / a real session-less result / a declared version (else it falls to the legacy baseline). 173 unit tests + verify:refs green.
- **v0.2.0 SHIPPED to npm** (2026-07-12, provenance; CI + Release + verify-refs green; cold `npx` confirmed).
- **Full scan RAN + writeup PUBLISHED (2026-07-12).** `npm run scan` over the live registry: **16,186 entries → 7,850 unique targets / 5,549 hosts**; 0 crashes, 522 retried. **Headline: of 4,356 open servers, 1 (0.02%) ready, 90.8% not-ready, 9.2% unknown** — framed as adoption (pre-GA), not breakage. Version histogram: 2025-11-25 modal (1,922), only **5** demonstrably speak 2026-07-28. RFC 9728 through the wall: 1,524/2,008 (75.9%). Published: `docs/scan-2026-07.md` + redacted `docs/scan-2026-07.aggregates.json` (host names → shares-only per user decision; `npm run scan:publish` regenerates it), linked from README.
- **Two adjudications during the sanity pass (both mattered):** (1) **version over-credit bug** — `newestDemonstratedVersion` was counting a `session-independence` pass as 2026-07-28, inflating that bucket 2513→ from the true 5 (2,511 were *old* stateless servers, some 2024-11-05); fixed to require discover-pass / routing-pass / declared. (2) Two **inconclusive-rate tripwires** (discover 36.3%, session 31.5%) tripped and were **adjudicated genuine** (real varied server errors, not a probe bug; readiness headline robust because it's driven by fails). Sanity protocol green: `scan:panel` matches known truth post-scan, CLI-vs-scan spot-checks 5/5, `verify:refs` green, freshness same-day.
- **Still pending (user-gated):** external cross-post of the writeup to a personal/company blog (repo is canonical). The open grade-weight question (warn=0.5) remains deferred — readiness decoupling sidestepped it.
