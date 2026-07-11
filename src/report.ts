import type { CheckResult, Preflight, Report } from "./types.js";

const c = {
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
};

const icons: Record<CheckResult["status"], string> = {
  pass: c.green("✔"),
  fail: c.red("✘"),
  warn: c.yellow("▲"),
  todo: c.dim("…"),
  error: c.red("!"),
  skipped: c.dim("◌"),
};

export function summarize(results: CheckResult[]): Report["summary"] {
  const summary = { pass: 0, fail: 0, warn: 0, todo: 0, error: 0, skipped: 0 };
  for (const r of results) summary[r.status]++;
  return summary;
}

/**
 * A letter grade needs at least this many decided checks. Below it (e.g. an
 * auth-walled endpoint where only auth-metadata runs) the grade stays "?" —
 * one or two decided checks aren't a representative sample to letter-grade.
 */
export const MIN_DECIDED_FOR_GRADE = 3;

/**
 * Grade only over decided checks (pass/fail/warn). warn counts half.
 * Returns "?" when fewer than MIN_DECIDED_FOR_GRADE checks are decided.
 */
export function grade(results: CheckResult[]): string {
  const decided = results.filter((r) => ["pass", "fail", "warn"].includes(r.status));
  if (decided.length < MIN_DECIDED_FOR_GRADE) return "?";
  const score =
    decided.reduce((acc, r) => acc + (r.status === "pass" ? 1 : r.status === "warn" ? 0.5 : 0), 0) /
    decided.length;
  if (score >= 0.9) return "A";
  if (score >= 0.75) return "B";
  if (score >= 0.6) return "C";
  if (score >= 0.4) return "D";
  return "F";
}

export function buildReport(
  url: string,
  toolVersion: string,
  preflight: Preflight,
  results: CheckResult[],
): Report {
  return {
    url,
    timestamp: new Date().toISOString(),
    toolVersion,
    targetSpec: "2026-07-28",
    preflight,
    results,
    grade: grade(results),
    summary: summarize(results),
  };
}

export function renderTerminal(report: Report): string {
  const lines: string[] = [];
  lines.push("");
  lines.push(c.bold(`mcp-spec-check — readiness for MCP spec 2026-07-28`));
  lines.push(c.dim(report.url));
  lines.push(c.dim(`access: ${report.preflight.access} · ${report.preflight.detail}`));
  lines.push("");
  for (const r of report.results) {
    lines.push(`  ${icons[r.status]} ${r.title}`);
    lines.push(`    ${c.dim(r.detail)}`);
    if (r.status === "fail" && r.fixUrl) lines.push(`    ${c.dim(`fix: ${r.fixUrl}`)}`);
  }
  lines.push("");
  const s = report.summary;
  lines.push(
    `  grade: ${c.bold(report.grade)}   ` +
      c.dim(
        `${s.pass} pass · ${s.fail} fail · ${s.warn} warn · ${s.skipped} skipped · ${s.todo} todo · ${s.error} error`,
      ),
  );
  if (s.todo > 0) {
    lines.push(c.dim(`  note: ${s.todo} checks not implemented yet — grade is partial`));
  }
  const decided = s.pass + s.fail + s.warn;
  if (report.grade === "?" && decided > 0 && decided < MIN_DECIDED_FOR_GRADE) {
    lines.push(c.dim(`  note: only ${decided} decided check(s) — too few for a letter grade`));
  }
  if (report.preflight.access === "auth-required") {
    lines.push(c.dim(`  note: endpoint is auth-walled — pass --bearer <token> to probe it`));
  }
  lines.push("");
  return lines.join("\n");
}

/** Exit code contract: 0 = ready, 1 = at least one fail, 2 = couldn't test. */
export function exitCode(report: Report): number {
  if (report.preflight.access !== "open") return 2;
  if (report.summary.error > 0) return 2;
  if (report.summary.fail > 0) return 1;
  return 0;
}
