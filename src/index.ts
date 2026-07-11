#!/usr/bin/env node
import { allChecks } from "./checks/index.js";
import { buildReport, exitCode, renderTerminal } from "./report.js";
import { NotImplementedError, type CheckResult, type ProbeContext } from "./types.js";

const VERSION = "0.0.1";

function usage(): void {
  console.log(`
mcp-ready — will your remote MCP server break on the 2026-07-28 spec release?

Usage:
  npx mcp-ready <url> [options]

Options:
  --json          Output machine-readable JSON instead of the terminal report
  --timeout <ms>  Per-probe timeout (default 15000)
  --verbose       Include the "why" for each check
  --version       Print version
  --help          Show this help

Exit codes:
  0  ready (no failing checks)
  1  at least one check failed
  2  probe error (couldn't test the server)
`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.length === 0) {
    usage();
    process.exit(args.length === 0 ? 2 : 0);
  }
  if (args.includes("--version")) {
    console.log(VERSION);
    process.exit(0);
  }

  const url = args.find((a) => !a.startsWith("--"));
  if (!url || !/^https?:\/\//.test(url)) {
    console.error("error: expected an http(s) URL of a remote MCP server");
    process.exit(2);
  }

  const timeoutIdx = args.indexOf("--timeout");
  const ctx: ProbeContext = {
    url,
    timeoutMs: timeoutIdx >= 0 ? Number(args[timeoutIdx + 1] ?? 15000) : 15000,
    verbose: args.includes("--verbose"),
  };

  const results: CheckResult[] = [];
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

  const report = buildReport(url, VERSION, results);
  if (args.includes("--json")) {
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
