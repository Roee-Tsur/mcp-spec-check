# Contributing

Thanks for helping make `mcp-spec-check` more accurate.

## Setup

```bash
git clone https://github.com/Roee-Tsur/mcp-spec-check.git
cd mcp-spec-check
npm install
npm test
npm run dev -- https://some-mcp-server.com/mcp
```

## What's most useful

1. **Wrong verdicts.** If `mcp-spec-check` gives your server a wrong verdict (fails a ready server, or passes one that isn't), open an issue with the `--json` output and, if possible, what your server runs. Probe correctness beats new features.
2. **New checks.** One file per check in `src/checks/`, exporting a `CheckDefinition`. Document the probe plan in comments, cite the spec section, and verify against both an old-spec and an RC reference server before opening the PR.
3. **Spec-reading review.** Every probe encodes an interpretation of the spec text. Corrections with spec citations are very welcome.

## Ground rules

- Zero runtime dependencies — devDependencies only
- A broken server is a `fail` result, never a thrown error
- 401/403 is never a fail — auth-walled servers are classified and skipped, not graded
- Optional spec features `warn`, never `fail`
- Conventional commits (`feat:`, `fix:`, `docs:`, `chore:`)
- CI (typecheck + build + tests) must pass
