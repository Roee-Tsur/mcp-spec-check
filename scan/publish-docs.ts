/**
 * Produce the committed, PUBLISHABLE aggregate from a run's local aggregates.json:
 * host names redacted to shares-only (rank-anonymized), everything else intact.
 * The local scan-results/<date>/aggregates.json keeps real host names for the
 * operator; only this docs/ copy — which is what gets committed and cited — is
 * redacted. Reproducible: `npm run scan:publish`.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { redactHostNames, type Aggregates } from "./aggregate.js";
import { isMain, REPO_ROOT, resolveRunDate, runPaths } from "./paths.js";

const OUT = join(REPO_ROOT, "docs", "scan-2026-07.aggregates.json");

export function publishDocs(date = resolveRunDate("attach")): void {
  const p = runPaths(date);
  const agg = JSON.parse(readFileSync(p.aggregates, "utf8")) as Aggregates;
  const redacted = redactHostNames(agg);
  writeFileSync(OUT, JSON.stringify(redacted, null, 2) + "\n");
  process.stdout.write(
    `Wrote ${OUT} (redacted). Top-host labels: ${redacted.hostConcentration.topHosts
      .map((h) => h.host)
      .join(", ")}\n`,
  );
}

if (isMain(import.meta.url)) {
  publishDocs();
}
