/**
 * `npm run scan` — the full chain on one pinned date: fetch registry → probe all
 * targets → aggregate. Each step is resumable, so re-running after an
 * interruption picks up where it stopped. Importing the step modules does not
 * re-trigger their CLI entrypoints (their isMain guard sees run.ts as argv[1]).
 */
import { aggregateScan } from "./aggregate.js";
import { fetchRegistry } from "./fetch-registry.js";
import { isMain, resolveDate } from "./paths.js";
import { probeAll, type ProbeAllOptions } from "./probe-all.js";

export async function runScan(date = resolveDate(), probeOpts: ProbeAllOptions = {}): Promise<void> {
  await fetchRegistry(date);
  await probeAll(date, probeOpts);
  aggregateScan(date);
}

if (isMain(import.meta.url)) {
  runScan().catch((err) => {
    console.error("scan fatal:", err);
    process.exit(1);
  });
}
