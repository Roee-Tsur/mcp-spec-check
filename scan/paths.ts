/**
 * Filesystem layout + small run helpers shared by the scan scripts. Everything
 * lands under scan-results/<date>/ (gitignored — per-server data never leaves
 * the machine; only docs/scan-2026-07.aggregates.json is committed).
 *
 *   scan-results/<date>/
 *     registry-snapshot.json   raw active+latest registry entries
 *     targets.json             deduped remote URLs to probe (+ funnel input)
 *     snapshot-funnel.json     entries → latest → remote → unique counts
 *     reports/<sha256-16>.json per-URL probe envelope (resumable, one per target)
 *     aggregates.json          published aggregate (counts/percentages only)
 *     summary.md               human-readable run summary
 */
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { argv } from "node:process";

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = join(HERE, "..");
export const SCAN_ROOT = join(REPO_ROOT, "scan-results");

/** YYYY-MM-DD in UTC. */
export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** An explicitly-pinned run date from `--date YYYY-MM-DD` or $SCAN_DATE, if any. */
export function explicitDate(args: string[] = argv.slice(2)): string | undefined {
  const flagIdx = args.indexOf("--date");
  if (flagIdx >= 0 && args[flagIdx + 1]) return args[flagIdx + 1] as string;
  return process.env.SCAN_DATE || undefined;
}

/**
 * Resolve which run directory a step operates on:
 *  - "new"    (fetch, chain): explicit date, else today — start/overwrite a run.
 *  - "attach" (probe, aggregate): explicit date, else the LATEST existing run,
 *    else today. This is what makes a killed run resumable across midnight —
 *    `npm run scan:probe` re-attaches to the same dir and skips finished targets
 *    instead of silently starting a fresh (empty) run under the new day's date.
 */
export function resolveRunDate(mode: "new" | "attach"): string {
  const explicit = explicitDate();
  if (explicit) return explicit;
  if (mode === "attach") return latestRunDate() ?? today();
  return today();
}

export interface RunPaths {
  date: string;
  dir: string;
  registrySnapshot: string;
  targets: string;
  funnel: string;
  reportsDir: string;
  aggregates: string;
  summary: string;
}

export function runPaths(date: string): RunPaths {
  const dir = join(SCAN_ROOT, date);
  return {
    date,
    dir,
    registrySnapshot: join(dir, "registry-snapshot.json"),
    targets: join(dir, "targets.json"),
    funnel: join(dir, "snapshot-funnel.json"),
    reportsDir: join(dir, "reports"),
    aggregates: join(dir, "aggregates.json"),
    summary: join(dir, "summary.md"),
  };
}

/** Create the run directory tree (idempotent). */
export function ensureRunDirs(p: RunPaths): void {
  mkdirSync(p.reportsDir, { recursive: true });
}

/** Most recent existing run directory date, or undefined if none. */
export function latestRunDate(): string | undefined {
  try {
    const dates = readdirSync(SCAN_ROOT).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
    dates.sort();
    return dates.at(-1);
  } catch {
    return undefined;
  }
}

/** Stable 16-hex-char id for a target URL — the per-URL report filename. */
export function urlHash(url: string): string {
  return createHash("sha256").update(url).digest("hex").slice(0, 16);
}

/** True when this module's file is the process entrypoint (so scripts can auto-run). */
export function isMain(metaUrl: string): boolean {
  const entry = argv[1];
  if (!entry) return false;
  try {
    return realpathSync(fileURLToPath(metaUrl)) === realpathSync(entry);
  } catch {
    return fileURLToPath(metaUrl) === entry;
  }
}
