/**
 * Phase B step 2: probe every target with the same probeServer the CLI runs, and
 * write one resumable envelope per URL. Two rules make this safe to point at
 * thousands of strangers' servers overnight:
 *
 *  1. Host-serial. Targets are grouped by host; each host is probed strictly
 *     one-at-a-time, and only ~N hosts run concurrently. So gateway.pipeworx.io
 *     (1,217 endpoints on one host) never sees parallel probes — its serial
 *     queue is what bounds total wall time (~7h), and everyone else is polite by
 *     construction. A named scan User-Agent rides on every request.
 *  2. Bounded + resumable. 10s per probe, a 120s per-target wall-clock budget,
 *     and a skip-if-file-exists check so an interrupted run continues where it
 *     stopped. One end-of-run retry pass re-probes crash/unreachable targets at
 *     low concurrency.
 */
import { existsSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { argv } from "node:process";
import { setTimeout as sleep } from "node:timers/promises";
import { probeServer } from "../src/probe.js";
import type { ProbeContext } from "../src/types.js";
import { REPO_URL, VERSION } from "../src/version.js";
import { groupByHost, type Target } from "./registry.js";
import { isMain, resolveDate, runPaths, urlHash, type RunPaths } from "./paths.js";
import type { Envelope, ProbeOutcome } from "./types.js";

const SCAN_UA = `mcp-spec-check-scan/${VERSION} (+${REPO_URL})`;
const DEFAULT_CONCURRENCY = 12;
const PROBE_TIMEOUT_MS = 10_000;
const BUDGET_MS = 120_000;

interface ProbeOptions {
  timeoutMs: number;
  budgetMs: number;
}

/** Probe a single target; never throws — a probeServer bug becomes outcome "crash". */
export async function probeOne(target: Target, opts: ProbeOptions, attempt = 1): Promise<Envelope> {
  const startedAt = new Date().toISOString();
  const ctx: ProbeContext = {
    url: target.url,
    timeoutMs: opts.timeoutMs,
    verbose: false,
    headers: { "user-agent": SCAN_UA },
  };

  let outcome: ProbeOutcome;
  let report: Envelope["report"];
  let error: string | undefined;
  try {
    const raced = await Promise.race([
      probeServer(ctx).then((r) => ({ kind: "ok" as const, report: r })),
      sleep(opts.budgetMs).then(() => ({ kind: "budget" as const })),
    ]);
    if (raced.kind === "ok") {
      outcome = "ok";
      report = raced.report;
    } else {
      outcome = "budget-exceeded";
      error = `exceeded ${opts.budgetMs}ms budget`;
    }
  } catch (err) {
    outcome = "crash";
    error = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  }

  return {
    url: target.url,
    hash: urlHash(target.url),
    outcome,
    startedAt,
    finishedAt: new Date().toISOString(),
    attempts: attempt,
    ...(report ? { report } : {}),
    ...(error ? { error } : {}),
  };
}

function envelopePath(p: RunPaths, url: string): string {
  return join(p.reportsDir, `${urlHash(url)}.json`);
}

function writeEnvelope(p: RunPaths, env: Envelope): void {
  const dest = envelopePath(p, env.url);
  const tmp = `${dest}.tmp`;
  writeFileSync(tmp, JSON.stringify(env));
  renameSync(tmp, dest); // atomic: a reader never sees a half-written file
}

/** A crash or a report that couldn't reach the server — worth one retry. */
function shouldRetry(env: Envelope): boolean {
  if (env.outcome === "crash" || env.outcome === "budget-exceeded") return true;
  return env.report?.preflight.access === "unreachable";
}

/** Minimal promise concurrency limiter (zero deps). */
function pLimit(concurrency: number): <T>(fn: () => Promise<T>) => Promise<T> {
  let active = 0;
  const queue: Array<() => void> = [];
  const drain = () => {
    active--;
    queue.shift()?.();
  };
  return <T>(fn: () => Promise<T>) =>
    new Promise<T>((resolve, reject) => {
      const run = () => {
        active++;
        fn().then(resolve, reject).finally(drain);
      };
      if (active < concurrency) run();
      else queue.push(run);
    });
}

interface Counters {
  done: number;
  total: number;
  skipped: number;
  ok: number;
  crash: number;
  budget: number;
}

function logProgress(c: Counters): void {
  process.stdout.write(
    `  [${c.done}/${c.total}] ok=${c.ok} crash=${c.crash} budget=${c.budget} skipped=${c.skipped}\n`,
  );
}

export interface ProbeAllOptions {
  concurrency?: number;
  /** Probe only the first N targets (smoke runs). */
  limit?: number;
}

export async function probeAll(date = resolveDate(), opts: ProbeAllOptions = {}): Promise<void> {
  const p = runPaths(date);
  const all = JSON.parse(readFileSync(p.targets, "utf8")) as Target[];
  const targets = opts.limit ? all.slice(0, opts.limit) : all;
  const concurrency = opts.concurrency ?? DEFAULT_CONCURRENCY;
  const probeOpts: ProbeOptions = { timeoutMs: PROBE_TIMEOUT_MS, budgetMs: BUDGET_MS };

  const byHost = groupByHost(targets);
  const c: Counters = { done: 0, total: targets.length, skipped: 0, ok: 0, crash: 0, budget: 0 };
  process.stdout.write(
    `Probing ${targets.length} targets across ${byHost.size} hosts (concurrency ${concurrency})\n`,
  );

  const tally = (env: Envelope) => {
    c.done++;
    if (env.outcome === "ok") c.ok++;
    else if (env.outcome === "crash") c.crash++;
    else c.budget++;
    if (c.done % 50 === 0 || c.done === c.total) logProgress(c);
  };

  const limit = pLimit(concurrency);

  // Main pass: each host serial, ~N hosts in flight. Skip targets already probed.
  const probeHost = async (hostTargets: Target[]): Promise<void> => {
    for (const target of hostTargets) {
      if (existsSync(envelopePath(p, target.url))) {
        c.skipped++;
        c.done++;
        continue;
      }
      const env = await probeOne(target, probeOpts);
      writeEnvelope(p, env);
      tally(env);
    }
  };
  await Promise.all([...byHost.values()].map((hostTargets) => limit(() => probeHost(hostTargets))));
  logProgress(c);

  // Retry pass: re-probe crash / unreachable / budget-exceeded once, low concurrency.
  const retryTargets: Target[] = [];
  for (const target of targets) {
    const file = envelopePath(p, target.url);
    if (!existsSync(file)) continue;
    const env = JSON.parse(readFileSync(file, "utf8")) as Envelope;
    if (shouldRetry(env)) retryTargets.push(target);
  }
  if (retryTargets.length > 0) {
    process.stdout.write(`\nRetry pass: ${retryTargets.length} crash/unreachable targets (concurrency 4)\n`);
    const retryLimit = pLimit(4);
    const byRetryHost = groupByHost(retryTargets);
    let retried = 0;
    await Promise.all(
      [...byRetryHost.values()].map((hostTargets) =>
        retryLimit(async () => {
          for (const target of hostTargets) {
            const prev = JSON.parse(readFileSync(envelopePath(p, target.url), "utf8")) as Envelope;
            const env = await probeOne(target, probeOpts, (prev.attempts ?? 1) + 1);
            // Keep the retry only if it's at least as decisive as the first try.
            if (env.outcome === "ok" || prev.outcome !== "ok") writeEnvelope(p, env);
            retried++;
            if (retried % 25 === 0) process.stdout.write(`  retried ${retried}/${retryTargets.length}\n`);
          }
        }),
      ),
    );
  }

  const written = readdirSync(p.reportsDir).filter((f) => f.endsWith(".json")).length;
  process.stdout.write(`\nDone. ${written} envelopes in ${p.reportsDir}\n`);
}

function parseCliOptions(args: string[]): ProbeAllOptions {
  const opts: ProbeAllOptions = {};
  const conc = args.indexOf("--concurrency");
  if (conc >= 0 && args[conc + 1]) opts.concurrency = Number(args[conc + 1]);
  else if (process.env.SCAN_CONCURRENCY) opts.concurrency = Number(process.env.SCAN_CONCURRENCY);
  const lim = args.indexOf("--limit");
  if (lim >= 0 && args[lim + 1]) opts.limit = Number(args[lim + 1]);
  return opts;
}

if (isMain(import.meta.url)) {
  probeAll(resolveDate(), parseCliOptions(argv.slice(2))).catch((err) => {
    console.error("probe-all fatal:", err);
    process.exit(1);
  });
}
