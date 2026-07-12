/**
 * Phase B step 3: fold a directory of per-URL envelopes into published
 * aggregates — counts, percentages, and version buckets ONLY. No URL, host-less
 * readiness, no per-server verdict crosses into the output (rule 6 / rule 9):
 * renderSummaryMd takes nothing but an Aggregates, so nothing identifying can
 * leak into the writeup. The one place hosts are named is the concentration
 * table, and only as neutral registry composition (share of target URLs) — never
 * tied to a readiness verdict.
 *
 * Every headline number is reported twice: endpoint-level and host-collapsed
 * (same-host families collapsed to one majority vote), so "your X% is one
 * gateway counted 1,217 times" is answered inside the data.
 *
 * Built-in tripwires halt publication when the numbers smell like a probe bug
 * rather than an ecosystem finding.
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { allChecks } from "../src/checks/index.js";
import { REQUIRED_CHECK_IDS } from "../src/report.js";
import type { CheckStatus, Readiness, Report } from "../src/types.js";
import type { Funnel } from "./registry.js";
import { isMain, resolveRunDate, runPaths } from "./paths.js";
import type { Envelope } from "./types.js";

const ALL_CHECK_IDS = allChecks.map((c) => c.id);
/** Checks that are optional/forward-looking: they must NEVER emit a fail (tripwire). */
const WARN_ONLY_CHECK_IDS = ALL_CHECK_IDS.filter(
  (id) => !(REQUIRED_CHECK_IDS as readonly string[]).includes(id),
);

type StatusCounts = Record<CheckStatus, number>;
function zeroCounts(): StatusCounts {
  return { pass: 0, fail: 0, warn: 0, inconclusive: 0, todo: 0, error: 0, skipped: 0 };
}

function checkStatus(report: Report, id: string): CheckStatus | undefined {
  return report.results.find((r) => r.id === id)?.status;
}

/**
 * The newest protocol version a server demonstrably speaks, for the histogram.
 * "Demonstrably" is the operative word: a modern-shaped ERROR (e.g. a -32600 to
 * a next-mode probe, which the transport layer optimistically labels "next")
 * is NOT a demonstration — the DeepWiki-style ambiguous servers answer the
 * legacy initialize and -32600 everything else, and crediting them as 2026-07-28
 * would inflate the headline. So the target bucket requires a positive success:
 *  - "2026-07-28"        discover advertised it, OR a session-less next-mode
 *                        request actually returned a result (session-independence
 *                        pass), OR it declared the version
 *  - a legacy date       negotiated via initialize (preflight.baseline)
 *  - "modern-undeclared" spoke next-mode shape but never a successful result and
 *                        named no version (weakest signal, no legacy baseline)
 *  - "unknown"           nothing observable
 */
export function newestDemonstratedVersion(report: Report): string {
  const declared = report.protocol?.declaredVersions ?? [];
  const demonstratedTarget =
    checkStatus(report, "discover") === "pass" ||
    checkStatus(report, "session-independence") === "pass" ||
    declared.includes("2026-07-28");
  if (demonstratedTarget) return "2026-07-28";
  if (report.preflight.baseline) return report.preflight.baseline;
  if (report.protocol?.transportMode === "next" || declared.length > 0) return "modern-undeclared";
  return "unknown";
}

/** Deterministic majority collapse: most frequent value; ties broken by `priority`. */
function majority<T extends string>(values: T[], priority: T[]): T | undefined {
  if (values.length === 0) return undefined;
  const counts = new Map<T, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: T | undefined;
  let bestN = -1;
  for (const cand of priority) {
    const n = counts.get(cand) ?? 0;
    if (n > bestN) {
      bestN = n;
      best = cand;
    }
  }
  // Any value not in `priority` (shouldn't happen for our unions) — fall back to raw max.
  for (const [v, n] of counts) {
    if (n > bestN) {
      bestN = n;
      best = v;
    }
  }
  return best;
}

const READINESS_PRIORITY: Readiness[] = ["not-ready", "ready", "unknown"];

export interface Tripwire {
  name: string;
  tripped: boolean;
  detail: string;
  sampleHashes: string[];
}

export interface Aggregates {
  meta: {
    toolVersion: string;
    targetSpec: string;
    date: string;
    generatedAt: string;
    envelopes: number;
  };
  funnel: Funnel;
  outcomes: { ok: number; budgetExceeded: number; crash: number };
  /** Access classification over envelopes that produced a report. */
  access: { probed: number; open: number; authRequired: number; notMcp: number; unreachable: number };
  /** Per-check status counts over open servers. */
  checkStatusCounts: Record<string, StatusCounts>;
  readiness: {
    endpointLevel: { total: number; ready: number; notReady: number; unknown: number };
    hostCollapsed: { total: number; ready: number; notReady: number; unknown: number };
  };
  versions: {
    endpointLevel: Record<string, number>;
    hostCollapsed: Record<string, number>;
  };
  authWalledRfc9728: { total: number; withMetadata: number; withoutMetadata: number };
  hostConcentration: {
    totalTargets: number;
    uniqueHosts: number;
    topHostSharePct: number;
    top10SharePct: number;
    topHosts: Array<{ host: string; urlCount: number; sharePct: number }>;
  };
  quality: {
    inconclusiveRatePctByCheck: Record<string, number>;
    errorsByCheck: Record<string, number>;
    budgetExceeded: number;
    crashes: number;
    retried: number;
  };
  tripwires: Tripwire[];
}

const pct = (n: number, d: number): number => (d === 0 ? 0 : Math.round((n / d) * 1000) / 10);

export interface AggregateMeta {
  toolVersion: string;
  date: string;
  generatedAt: string;
}

export function aggregate(envelopes: Envelope[], funnel: Funnel, meta: AggregateMeta): Aggregates {
  const outcomes = { ok: 0, budgetExceeded: 0, crash: 0 };
  const access = { probed: 0, open: 0, authRequired: 0, notMcp: 0, unreachable: 0 };
  const openReports: Report[] = [];
  const openHosts = new Map<string, Report[]>();
  const authWalled: Report[] = [];
  const hostUrlCounts = new Map<string, number>();
  let retried = 0;

  const hostOf = (url: string): string => {
    try {
      return new URL(url).hostname.toLowerCase();
    } catch {
      return url;
    }
  };

  for (const env of envelopes) {
    if (env.outcome === "ok") outcomes.ok++;
    else if (env.outcome === "budget-exceeded") outcomes.budgetExceeded++;
    else outcomes.crash++;
    if ((env.attempts ?? 1) > 1) retried++;
    hostUrlCounts.set(hostOf(env.url), (hostUrlCounts.get(hostOf(env.url)) ?? 0) + 1);

    const report = env.report;
    if (!report) continue;
    access.probed++;
    switch (report.preflight.access) {
      case "open":
        access.open++;
        openReports.push(report);
        {
          const host = hostOf(env.url);
          const list = openHosts.get(host);
          if (list) list.push(report);
          else openHosts.set(host, [report]);
        }
        break;
      case "auth-required":
        access.authRequired++;
        authWalled.push(report);
        break;
      case "not-mcp":
        access.notMcp++;
        break;
      case "unreachable":
        access.unreachable++;
        break;
    }
  }

  // Per-check status counts + quality rates over open servers.
  const checkStatusCounts: Record<string, StatusCounts> = {};
  for (const id of ALL_CHECK_IDS) checkStatusCounts[id] = zeroCounts();
  for (const report of openReports) {
    for (const r of report.results) {
      const bucket = checkStatusCounts[r.id];
      if (bucket) bucket[r.status]++;
    }
  }

  const inconclusiveRatePctByCheck: Record<string, number> = {};
  const errorsByCheck: Record<string, number> = {};
  for (const id of ALL_CHECK_IDS) {
    const cc = checkStatusCounts[id] ?? zeroCounts();
    inconclusiveRatePctByCheck[id] = pct(cc.inconclusive, openReports.length);
    errorsByCheck[id] = cc.error;
  }

  // Readiness — endpoint-level and host-collapsed (majority vote per host).
  const endpointReadiness = { total: openReports.length, ready: 0, notReady: 0, unknown: 0 };
  for (const report of openReports) {
    if (report.readiness === "ready") endpointReadiness.ready++;
    else if (report.readiness === "not-ready") endpointReadiness.notReady++;
    else endpointReadiness.unknown++;
  }
  const hostReadiness = { total: openHosts.size, ready: 0, notReady: 0, unknown: 0 };
  for (const reports of openHosts.values()) {
    const vote = majority(
      reports.map((r) => r.readiness),
      READINESS_PRIORITY,
    );
    if (vote === "ready") hostReadiness.ready++;
    else if (vote === "not-ready") hostReadiness.notReady++;
    else hostReadiness.unknown++;
  }

  // Version histogram — endpoint-level and host-collapsed.
  const versionsEndpoint: Record<string, number> = {};
  for (const report of openReports) {
    const v = newestDemonstratedVersion(report);
    versionsEndpoint[v] = (versionsEndpoint[v] ?? 0) + 1;
  }
  const versionsHost: Record<string, number> = {};
  for (const reports of openHosts.values()) {
    const versions = reports.map(newestDemonstratedVersion);
    const uniquePriority = [...new Set(versions)];
    const v = majority(versions, uniquePriority) ?? "unknown";
    versionsHost[v] = (versionsHost[v] ?? 0) + 1;
  }

  // RFC 9728 through the auth wall.
  const authWalledRfc9728 = { total: authWalled.length, withMetadata: 0, withoutMetadata: 0 };
  for (const report of authWalled) {
    if (checkStatus(report, "auth-metadata") === "pass") authWalledRfc9728.withMetadata++;
    else authWalledRfc9728.withoutMetadata++;
  }

  // Host concentration (neutral registry composition — no readiness attached).
  const totalTargets = envelopes.length;
  const sortedHosts = [...hostUrlCounts.entries()].sort((a, b) => b[1] - a[1]);
  const topHosts = sortedHosts.slice(0, 10).map(([host, urlCount]) => ({
    host,
    urlCount,
    sharePct: pct(urlCount, totalTargets),
  }));
  const top10Count = sortedHosts.slice(0, 10).reduce((acc, [, n]) => acc + n, 0);
  const hostConcentration = {
    totalTargets,
    uniqueHosts: hostUrlCounts.size,
    topHostSharePct: pct(sortedHosts[0]?.[1] ?? 0, totalTargets),
    top10SharePct: pct(top10Count, totalTargets),
    topHosts,
  };

  const tripwires = computeTripwires(envelopes, openReports, checkStatusCounts);

  return {
    meta: {
      toolVersion: meta.toolVersion,
      targetSpec: "2026-07-28",
      date: meta.date,
      generatedAt: meta.generatedAt,
      envelopes: envelopes.length,
    },
    funnel,
    outcomes,
    access,
    checkStatusCounts,
    readiness: { endpointLevel: endpointReadiness, hostCollapsed: hostReadiness },
    versions: { endpointLevel: versionsEndpoint, hostCollapsed: versionsHost },
    authWalledRfc9728,
    hostConcentration,
    quality: {
      inconclusiveRatePctByCheck,
      errorsByCheck,
      budgetExceeded: outcomes.budgetExceeded,
      crashes: outcomes.crash,
      retried,
    },
    tripwires,
  };
}

/** Sample envelope hashes whose open report matches a predicate — for tripwire triage. */
function sampleHashes(envelopes: Envelope[], match: (r: Report) => boolean, n = 5): string[] {
  const out: string[] = [];
  for (const env of envelopes) {
    if (env.report && env.report.preflight.access === "open" && match(env.report)) {
      out.push(env.hash);
      if (out.length >= n) break;
    }
  }
  return out;
}

/**
 * Tripwires that halt publication — each signals "probe bug", not "ecosystem
 * finding": a check erroring on >5% of open servers, going inconclusive on >30%,
 * never passing anywhere it's decided, or a warn-only check ever producing a fail.
 */
export function computeTripwires(
  envelopes: Envelope[],
  openReports: Report[],
  counts: Record<string, StatusCounts>,
): Tripwire[] {
  const open = openReports.length;
  const wires: Tripwire[] = [];

  for (const id of ALL_CHECK_IDS) {
    const cc = counts[id] ?? zeroCounts();
    if (pct(cc.error, open) > 5) {
      wires.push({
        name: `error-rate:${id}`,
        tripped: true,
        detail: `${id} errored on ${cc.error}/${open} open servers (${pct(cc.error, open)}% > 5%)`,
        sampleHashes: sampleHashes(envelopes, (r) => checkStatus(r, id) === "error"),
      });
    }
    if (pct(cc.inconclusive, open) > 30) {
      wires.push({
        name: `inconclusive-rate:${id}`,
        tripped: true,
        detail: `${id} inconclusive on ${cc.inconclusive}/${open} open servers (${pct(cc.inconclusive, open)}% > 30%)`,
        sampleHashes: sampleHashes(envelopes, (r) => checkStatus(r, id) === "inconclusive"),
      });
    }
    const decided = cc.pass + cc.fail + cc.warn;
    if (decided >= 20 && cc.pass === 0) {
      wires.push({
        name: `zero-passes:${id}`,
        tripped: true,
        detail: `${id} passed 0 times across ${decided} decided open servers — suspect a probe bug`,
        sampleHashes: sampleHashes(envelopes, (r) => checkStatus(r, id) === "fail"),
      });
    }
  }

  for (const id of WARN_ONLY_CHECK_IDS) {
    const cc = counts[id] ?? zeroCounts();
    if (cc.fail > 0) {
      wires.push({
        name: `warn-only-fail:${id}`,
        tripped: true,
        detail: `${id} is warn-only but produced ${cc.fail} fail(s) — a check bug`,
        sampleHashes: sampleHashes(envelopes, (r) => checkStatus(r, id) === "fail"),
      });
    }
  }

  return wires;
}

export function renderSummaryMd(agg: Aggregates): string {
  const L: string[] = [];
  const r = agg.readiness;
  const open = r.endpointLevel.total;
  L.push(`# MCP registry readiness scan — ${agg.meta.date}`);
  L.push("");
  L.push(`_Generated ${agg.meta.generatedAt} by mcp-spec-check ${agg.meta.toolVersion}. Target: MCP spec ${agg.meta.targetSpec}._`);
  L.push("");
  L.push("**Nothing switches off on 2026-07-28** — the spec text publishes that day, version negotiation continues, and deprecated features live ≥12 months. These are adoption/readiness numbers, not breakage counts.");
  L.push("");
  L.push("## Funnel");
  const f = agg.funnel;
  L.push(`- ${f.totalEntries} registry entries → ${f.activeLatest} active+latest → ${f.withRemotes} with remotes`);
  L.push(`- ${f.remoteUrls} remote URLs − ${f.junkUrls} junk → **${f.uniqueUrls} unique targets** across ${f.uniqueHosts} hosts`);
  L.push(`- declared transports: ${Object.entries(f.byDeclaredType).map(([k, v]) => `${k} ${v}`).join(", ")}`);
  L.push("");
  L.push("## Access (of probed endpoints)");
  const a = agg.access;
  L.push(`| class | count | % of probed |`);
  L.push(`| --- | ---: | ---: |`);
  L.push(`| open | ${a.open} | ${pct(a.open, a.probed)}% |`);
  L.push(`| auth-required | ${a.authRequired} | ${pct(a.authRequired, a.probed)}% |`);
  L.push(`| not-MCP | ${a.notMcp} | ${pct(a.notMcp, a.probed)}% |`);
  L.push(`| unreachable | ${a.unreachable} | ${pct(a.unreachable, a.probed)}% |`);
  L.push(`| (probe crash / budget) | ${agg.outcomes.crash + agg.outcomes.budgetExceeded} | — |`);
  L.push("");
  L.push(`## Readiness for 2026-07-28 (required-3 checks, over ${open} open servers)`);
  L.push(`| view | ready | not-ready | unknown |`);
  L.push(`| --- | ---: | ---: | ---: |`);
  L.push(
    `| endpoint-level | ${r.endpointLevel.ready} (${pct(r.endpointLevel.ready, open)}%) | ${r.endpointLevel.notReady} (${pct(r.endpointLevel.notReady, open)}%) | ${r.endpointLevel.unknown} (${pct(r.endpointLevel.unknown, open)}%) |`,
  );
  const hc = r.hostCollapsed;
  L.push(
    `| host-collapsed | ${hc.ready} (${pct(hc.ready, hc.total)}%) | ${hc.notReady} (${pct(hc.notReady, hc.total)}%) | ${hc.unknown} (${pct(hc.unknown, hc.total)}%) |`,
  );
  L.push("");
  L.push("## Newest protocol version demonstrated (open servers)");
  L.push(`| version | endpoint-level | host-collapsed |`);
  L.push(`| --- | ---: | ---: |`);
  const versionKeys = [...new Set([...Object.keys(agg.versions.endpointLevel), ...Object.keys(agg.versions.hostCollapsed)])].sort();
  for (const v of versionKeys) {
    L.push(`| ${v} | ${agg.versions.endpointLevel[v] ?? 0} | ${agg.versions.hostCollapsed[v] ?? 0} |`);
  }
  L.push("");
  L.push("## Per-check status (open servers)");
  L.push(`| check | pass | fail | warn | inconclusive | skipped |`);
  L.push(`| --- | ---: | ---: | ---: | ---: | ---: |`);
  for (const id of ALL_CHECK_IDS) {
    const c = agg.checkStatusCounts[id] ?? zeroCounts();
    L.push(`| ${id} | ${c.pass} | ${c.fail} | ${c.warn} | ${c.inconclusive} | ${c.skipped} |`);
  }
  L.push("");
  L.push("## RFC 9728 auth metadata (through the auth wall)");
  const rf = agg.authWalledRfc9728;
  L.push(`- ${rf.withMetadata}/${rf.total} auth-required servers publish protected-resource metadata (${pct(rf.withMetadata, rf.total)}%)`);
  L.push("");
  L.push("## Host concentration (registry composition — no readiness attached)");
  L.push(`- top host holds ${agg.hostConcentration.topHostSharePct}% of targets; top-10 hold ${agg.hostConcentration.top10SharePct}%`);
  L.push(`| host | target URLs | share |`);
  L.push(`| --- | ---: | ---: |`);
  for (const h of agg.hostConcentration.topHosts) L.push(`| ${h.host} | ${h.urlCount} | ${h.sharePct}% |`);
  L.push("");
  L.push("## Quality");
  L.push(`- probe crashes: ${agg.quality.crashes}; budget-exceeded: ${agg.quality.budgetExceeded}; retried targets: ${agg.quality.retried}`);
  L.push(`- inconclusive rate by check: ${Object.entries(agg.quality.inconclusiveRatePctByCheck).map(([k, v]) => `${k} ${v}%`).join(", ")}`);
  L.push("");
  const tripped = agg.tripwires.filter((t) => t.tripped);
  L.push(`## Tripwires: ${tripped.length === 0 ? "none tripped ✅" : `${tripped.length} TRIPPED ⛔`}`);
  for (const t of tripped) L.push(`- **${t.name}** — ${t.detail} (samples: ${t.sampleHashes.join(", ") || "none"})`);
  L.push("");
  return L.join("\n");
}

export function aggregateScan(date = resolveRunDate("attach")): Aggregates {
  const p = runPaths(date);
  const funnel = JSON.parse(readFileSync(p.funnel, "utf8")) as Funnel;
  const files = readdirSync(p.reportsDir).filter((f) => f.endsWith(".json") && !f.endsWith(".tmp"));
  const envelopes: Envelope[] = files.map(
    (f) => JSON.parse(readFileSync(join(p.reportsDir, f), "utf8")) as Envelope,
  );

  const agg = aggregate(envelopes, funnel, {
    toolVersion: envelopes.find((e) => e.report)?.report?.toolVersion ?? "unknown",
    date,
    generatedAt: new Date().toISOString(),
  });

  writeFileSync(p.aggregates, JSON.stringify(agg, null, 2));
  writeFileSync(p.summary, renderSummaryMd(agg));

  const tripped = agg.tripwires.filter((t) => t.tripped);
  process.stdout.write(`\nAggregated ${envelopes.length} envelopes → ${p.aggregates}\n`);
  process.stdout.write(renderSummaryMd(agg));
  if (tripped.length > 0) {
    process.stderr.write(`\n⛔ ${tripped.length} tripwire(s) tripped — do NOT publish until resolved.\n`);
    process.exitCode = 3;
  }
  return agg;
}

if (isMain(import.meta.url)) {
  try {
    aggregateScan();
  } catch (err) {
    console.error("aggregate fatal:", err);
    process.exit(1);
  }
}
