import type { CheckResult, Preflight, Readiness, Report } from "./types.js";

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
  inconclusive: c.dim("?"),
  todo: c.dim("…"),
  error: c.red("!"),
  skipped: c.dim("◌"),
};

export function summarize(results: CheckResult[]): Report["summary"] {
  const summary = { pass: 0, fail: 0, warn: 0, inconclusive: 0, todo: 0, error: 0, skipped: 0 };
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

/**
 * The spec-required checks that decide readiness — the three fail-able,
 * mandatory-behavior probes. Optional/forward-looking checks (cache-metadata,
 * mrtr, error-codes, deprecated-features, auth-metadata) inform the adoption
 * matrix and the letter grade, but never the ready/not-ready verdict.
 */
export const REQUIRED_CHECK_IDS = ["discover", "routing-headers", "session-independence"] as const;

/**
 * Headline verdict, decoupled from the letter grade:
 *  - "ready"      → every required check passed
 *  - "not-ready"  → at least one required check failed
 *  - "unknown"    → a required check couldn't be decided (inconclusive / skipped
 *                   / error / warn), e.g. an auth-walled or ambiguous endpoint
 *
 * A required `fail` dominates a required `unknown`: a server with one hard fail
 * is not-ready even if another required check was inconclusive.
 */
export function readiness(results: CheckResult[]): Readiness {
  const required = results.filter((r) => (REQUIRED_CHECK_IDS as readonly string[]).includes(r.id));
  if (required.some((r) => r.status === "fail")) return "not-ready";
  if (required.length === REQUIRED_CHECK_IDS.length && required.every((r) => r.status === "pass")) {
    return "ready";
  }
  return "unknown";
}

export function buildReport(
  url: string,
  toolVersion: string,
  preflight: Preflight,
  results: CheckResult[],
  protocol?: Report["protocol"],
): Report {
  return {
    url,
    timestamp: new Date().toISOString(),
    toolVersion,
    targetSpec: "2026-07-28",
    preflight,
    results,
    readiness: readiness(results),
    ...(protocol ? { protocol } : {}),
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
  const verdict =
    report.readiness === "ready"
      ? c.green("YES")
      : report.readiness === "not-ready"
        ? c.red("NO")
        : c.dim("UNKNOWN");
  lines.push(`  ${c.bold("ready for 2026-07-28:")} ${verdict}`);
  const s = report.summary;
  lines.push(
    `  grade: ${c.bold(report.grade)}   ` +
      c.dim(
        `${s.pass} pass · ${s.fail} fail · ${s.warn} warn · ${s.inconclusive} inconclusive · ${s.skipped} skipped · ${s.todo} todo · ${s.error} error`,
      ),
  );
  if (s.todo > 0) {
    lines.push(c.dim(`  note: ${s.todo} checks not implemented yet — grade is partial`));
  }
  const decided = s.pass + s.fail + s.warn;
  if (report.grade === "?" && decided > 0 && decided < MIN_DECIDED_FOR_GRADE) {
    lines.push(c.dim(`  note: only ${decided} decided check(s) — too few for a letter grade`));
  }
  if (report.grade === "?" && s.inconclusive > 0) {
    lines.push(
      c.dim(
        `  note: ${s.inconclusive} check(s) inconclusive — the server didn't answer the 2026-07-28 probes cleanly`,
      ),
    );
  }
  if (report.preflight.access === "auth-required") {
    lines.push(c.dim(`  note: endpoint is auth-walled — pass --bearer <token> to probe it`));
  }
  lines.push("");
  return lines.join("\n");
}

/**
 * Exit code contract: 0 = ready, 1 = at least one fail, 2 = couldn't test.
 * "Couldn't test" also covers an open endpoint we couldn't assess — a `?` grade
 * (too few decided checks, e.g. the server answered probes ambiguously).
 */
export function exitCode(report: Report): number {
  if (report.preflight.access !== "open") return 2;
  if (report.summary.error > 0) return 2;
  if (report.summary.fail > 0) return 1;
  if (report.grade === "?") return 2;
  return 0;
}
