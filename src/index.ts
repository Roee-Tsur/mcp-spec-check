#!/usr/bin/env node
import { parseArgs } from "./args.js";
import { allChecks } from "./checks/index.js";
import { classifyEndpoint } from "./preflight.js";
import { buildReport, exitCode, renderTerminal } from "./report.js";
import { NotImplementedError, type CheckResult, type ProbeContext } from "./types.js";

const VERSION = "0.0.1";

function usage(): void {
  console.log(`
mcp-ready — is your remote MCP server ready for the 2026-07-28 spec release?

Usage:
  npx mcp-ready <url> [options]

Options:
  --json              Output machine-readable JSON instead of the terminal report
  --timeout <ms>      Per-probe timeout (default 15000)
  --bearer <token>    Send Authorization: Bearer <token> with every probe
  --header "N: v"     Send an extra header with every probe (repeatable)
  --verbose           Include the "why" for each check
  --version           Print version
  --help              Show this help

Exit codes:
  0  ready (no failing checks)
  1  at least one check failed
  2  couldn't test (probe error, or endpoint auth-walled / unreachable / not MCP)
`);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);

  if (args.help || argv.length === 0) {
    usage();
    process.exit(argv.length === 0 ? 2 : 0);
  }
  if (args.version) {
    console.log(VERSION);
    process.exit(0);
  }
  if (args.error) {
    console.error(`error: ${args.error}`);
    process.exit(2);
  }
  if (!args.url || !/^https?:\/\//.test(args.url)) {
    console.error("error: expected an http(s) URL of a remote MCP server");
    process.exit(2);
  }

  const ctx: ProbeContext = {
    url: args.url,
    timeoutMs: args.timeoutMs,
    verbose: args.verbose,
    headers: args.headers,
  };

  const preflight = await classifyEndpoint(ctx);

  let results: CheckResult[];
  if (preflight.access !== "open") {
    const detail =
      preflight.access === "auth-required"
        ? "endpoint is auth-required — pass --bearer to probe authenticated servers"
        : `endpoint is ${preflight.access} — couldn't test`;
    results = allChecks.map((check) => ({
      id: check.id,
      title: check.title,
      status: "skipped" as const,
      detail,
      fixUrl: check.fixUrl,
    }));
  } else {
    results = [];
    for (const check of allChecks) {
      try {
        const partial = await check.run(ctx);
        results.push({ id: check.id, title: check.title, fixUrl: check.fixUrl, ...partial });
      } catch (err) {
        if (err instanceof NotImplementedError) {
          results.push({
            id: check.id,
            title: check.title,
            status: "todo",
            detail: err.note,
            fixUrl: check.fixUrl,
          });
        } else {
          results.push({
            id: check.id,
            title: check.title,
            status: "error",
            detail: err instanceof Error ? err.message : String(err),
            fixUrl: check.fixUrl,
          });
        }
      }
    }
  }

  const report = buildReport(ctx.url, VERSION, preflight, results);
  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(renderTerminal(report));
  }
  process.exit(exitCode(report));
}

main().catch((err) => {
  console.error("fatal:", err);
  process.exit(2);
});
