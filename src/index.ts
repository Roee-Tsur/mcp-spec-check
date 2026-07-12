#!/usr/bin/env node
import { parseArgs } from "./args.js";
import { probeServer } from "./probe.js";
import { exitCode, renderTerminal } from "./report.js";
import { type ProbeContext } from "./types.js";
import { VERSION } from "./version.js";

function usage(): void {
  console.log(`
mcp-spec-check — is your remote MCP server ready for the 2026-07-28 spec release?

Usage:
  npx mcp-spec-check <url> [options]

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
  2  couldn't test (probe error; endpoint auth-walled / unreachable / not MCP;
     or the server answered too ambiguously to grade)
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

  const report = await probeServer(ctx);
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
