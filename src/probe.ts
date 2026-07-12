/**
 * The probe pipeline as a library: preflight → check loop → Report. Pure of
 * process concerns — no argv, no console, no process.exit — so both the CLI
 * (src/index.ts) and the registry scan (scan/) drive the exact same code and
 * produce the exact same Report shape. The one word a scan reader sees in the
 * headline is the one word `npx mcp-spec-check` prints for them.
 *
 * Never throws for server behavior: a broken/ambiguous server yields fail /
 * inconclusive / error results inside the Report, and an unreachable one is
 * caught by preflight. The only throws that escape are genuine probe bugs
 * (surfaced per-check as an `error` result) — the loop already contains those.
 */
import { allChecks } from "./checks/index.js";
import { classifyEndpoint } from "./preflight.js";
import { getTransport } from "./probe-transport.js";
import { buildReport } from "./report.js";
import { NotImplementedError, type CheckResult, type ProbeContext, type Report } from "./types.js";
import { VERSION } from "./version.js";

export async function probeServer(ctx: ProbeContext): Promise<Report> {
  const preflight = await classifyEndpoint(ctx);
  ctx.preflight = preflight;

  // Warm the shared transport for open endpoints and record how a request mode
  // was established, so the scan can bucket by transport even when a check order
  // change would otherwise move which check acquires it.
  const protocol: NonNullable<Report["protocol"]> = {};
  if (preflight.access === "open") {
    const t = await getTransport(ctx);
    protocol.transportMode = t.mode;
  }

  // A check runs when the endpoint is open, or when it's auth-walled AND the
  // check opts into running there (auth-metadata: its /.well-known probe is
  // origin-level and works outside the auth wall). Everything else is skipped.
  const skipDetail =
    preflight.access === "auth-required"
      ? "endpoint is auth-required — pass --bearer to probe authenticated checks"
      : `endpoint is ${preflight.access} — couldn't test`;

  const results: CheckResult[] = [];
  for (const check of allChecks) {
    const shouldRun =
      preflight.access === "open" ||
      (preflight.access === "auth-required" && check.runsWhenAuthWalled === true);
    if (!shouldRun) {
      results.push({
        id: check.id,
        title: check.title,
        status: "skipped",
        detail: skipDetail,
        fixUrl: check.fixUrl,
      });
      continue;
    }
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

  // The version histogram's structural signal for modern servers: the versions
  // server/discover advertised (legacy servers' version lives in preflight.baseline).
  const discoverData = results.find((r) => r.id === "discover")?.data;
  const declaredVersions = discoverData?.["supportedVersions"];
  if (Array.isArray(declaredVersions) && declaredVersions.every((v) => typeof v === "string")) {
    protocol.declaredVersions = declaredVersions as string[];
  }

  const hasProtocol = protocol.transportMode !== undefined || protocol.declaredVersions !== undefined;
  return buildReport(ctx.url, VERSION, preflight, results, hasProtocol ? protocol : undefined);
}
