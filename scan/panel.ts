/**
 * Phase C sanity: run the scan's probe path against a known-truth panel and diff
 * the verdict against what we already know these servers do. If the machinery
 * miscalls a server whose behavior is established, every ecosystem number is
 * suspect — so this runs green same-day as the full scan and again before
 * publication.
 *
 * Live network. Public URLs below are best-known and flagged to re-verify; the
 * two local ref servers (start with `npm run refs:rc` / `refs:old`) are the
 * deterministic anchors. Unreachable panel entries are reported as SKIP, not
 * failure, so a missing ref server or a flaky network doesn't mask a real diff.
 *
 * Optional: set GITHUB_MCP_BEARER to also exercise GitHub's authenticated path.
 */
import { probeServer } from "../src/probe.js";
import type { Access, CheckStatus, ProbeContext, Readiness, Report } from "../src/types.js";
import { REPO_URL, VERSION } from "../src/version.js";
import { isMain } from "./paths.js";

const SCAN_UA = `mcp-spec-check-scan/${VERSION} (+${REPO_URL})`;

interface PanelExpect {
  access?: Access;
  readiness?: Readiness;
  /** A few check statuses we're confident about. */
  checks?: Record<string, CheckStatus>;
}

interface PanelEntry {
  label: string;
  url: string;
  headers?: Record<string, string>;
  expect: PanelExpect;
  note?: string;
}

const PANEL: PanelEntry[] = [
  {
    label: "ref RC 2026-07-28 (local)",
    url: "http://127.0.0.1:7102/mcp",
    expect: { access: "open", readiness: "ready", checks: { discover: "pass" } },
    note: "start with: npm run refs:rc",
  },
  {
    label: "ref old 2025-11-25 (local)",
    url: "http://127.0.0.1:7101/mcp",
    expect: { access: "open", readiness: "not-ready", checks: { discover: "fail" } },
    note: "start with: npm run refs:old",
  },
  {
    label: "GitHub MCP (no token)",
    url: "https://api.githubcopilot.com/mcp/",
    expect: { access: "auth-required", checks: { "auth-metadata": "pass" } },
    note: "auth-walled; RFC 9728 metadata readable through the wall",
  },
  {
    label: "DeepWiki",
    url: "https://mcp.deepwiki.com/mcp",
    expect: { access: "open", readiness: "unknown" },
    note: "answers legacy initialize, -32600s the 2026-07-28 probes → mostly inconclusive; RE-VERIFY URL",
  },
  {
    label: "Hugging Face MCP",
    url: "https://huggingface.co/mcp",
    expect: { access: "open", readiness: "not-ready" },
    note: "open, legacy server → required checks fail, 0 inconclusive; RE-VERIFY URL",
  },
];

const GREEN = (s: string) => `\x1b[32m${s}\x1b[0m`;
const RED = (s: string) => `\x1b[31m${s}\x1b[0m`;
const YELLOW = (s: string) => `\x1b[33m${s}\x1b[0m`;
const DIM = (s: string) => `\x1b[2m${s}\x1b[0m`;

function checkStatus(report: Report, id: string): CheckStatus | undefined {
  return report.results.find((r) => r.id === id)?.status;
}

async function runEntry(entry: PanelEntry): Promise<boolean> {
  const ctx: ProbeContext = {
    url: entry.url,
    timeoutMs: 10_000,
    verbose: false,
    headers: { "user-agent": SCAN_UA, ...entry.headers },
  };
  let report: Report;
  try {
    report = await probeServer(ctx);
  } catch (err) {
    console.log(`${RED("✗")} ${entry.label} ${DIM(entry.url)} — probe threw: ${String(err)}`);
    return false;
  }

  const access = report.preflight.access;
  // Unreachable when we expected something decisive → SKIP, don't fail.
  if (access === "unreachable" && entry.expect.access !== "unreachable") {
    console.log(`${YELLOW("○")} ${entry.label} ${DIM(entry.url)} — SKIP (unreachable: ${report.preflight.detail})`);
    return true;
  }

  const rows: string[] = [];
  let ok = true;
  const check = (label: string, got: unknown, want: unknown) => {
    const pass = got === want;
    if (!pass) ok = false;
    rows.push(`    ${pass ? GREEN("✓") : RED("✗")} ${label}: expected ${String(want)}, got ${String(got)}`);
  };
  if (entry.expect.access) check("access", access, entry.expect.access);
  if (entry.expect.readiness) check("readiness", report.readiness, entry.expect.readiness);
  for (const [id, want] of Object.entries(entry.expect.checks ?? {})) {
    check(`check ${id}`, checkStatus(report, id), want);
  }

  console.log(`${ok ? GREEN("✓") : RED("✗")} ${entry.label} ${DIM(entry.url)}`);
  if (entry.note) console.log(`    ${DIM(entry.note)}`);
  for (const row of rows) console.log(row);
  return ok;
}

export async function runPanel(): Promise<void> {
  console.log("Known-truth panel — scan probe path vs established behavior\n");
  let failures = 0;
  for (const entry of PANEL) {
    const ok = await runEntry(entry);
    if (!ok) failures++;
  }
  console.log("");
  if (failures > 0) {
    console.log(RED(`panel: ${failures} entr(y/ies) diverged from known truth — investigate before trusting scan numbers`));
    process.exit(1);
  }
  console.log(GREEN("panel: all entries match known truth"));
}

if (isMain(import.meta.url)) {
  runPanel().catch((err) => {
    console.error("panel fatal:", err);
    process.exit(1);
  });
}
