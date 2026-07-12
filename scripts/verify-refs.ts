/**
 * verify-refs — the live test oracle for mcp-spec-check (PLAN.md Milestone 1: "each
 * check verified against both reference servers before marking done").
 *
 * Spawns the two reference servers (old-spec 2025-11-25 + RC 2026-07-28) and a
 * tiny inline auth-walled endpoint, runs the real CLI end-to-end against each,
 * and asserts an expected per-check verdict matrix plus grade and exit code.
 * Exits non-zero on any mismatch.
 *
 * Run:  npm run verify:refs      (from repo root, under Node 22)
 *
 * Kept out of `npm test` (which stays pure/offline) because it needs ref-servers/
 * installed. CI runs it as a dedicated `verify-refs` job that installs those deps
 * first — see .github/workflows/ci.yml.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type Server } from "node:http";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

type Status = "pass" | "fail" | "warn" | "todo" | "error" | "skipped";

type Readiness = "ready" | "not-ready" | "unknown";

interface Expectation {
  url: string;
  exitCode: number;
  grade: string;
  readiness: Readiness;
  checks: Record<string, Status>;
}

const OLD_URL = "http://127.0.0.1:7101/mcp";
const RC_URL = "http://127.0.0.1:7102/mcp";
const AUTH_PORT = 7103;
const AUTH_URL = `http://127.0.0.1:${AUTH_PORT}/mcp`;
const AMBIG_PORT = 7104;
const AMBIG_URL = `http://127.0.0.1:${AMBIG_PORT}/mcp`;

const EXPECTED: Record<string, Expectation> = {
  "RC 2026-07-28": {
    url: RC_URL,
    exitCode: 0,
    grade: "A",
    readiness: "ready",
    checks: {
      discover: "pass",
      "routing-headers": "pass",
      "session-independence": "pass",
      "error-codes": "pass",
      "cache-metadata": "pass",
      mrtr: "pass",
      "deprecated-features": "pass",
      "auth-metadata": "skipped",
    },
  },
  "old 2025-11-25": {
    url: OLD_URL,
    exitCode: 1,
    grade: "F",
    readiness: "not-ready",
    checks: {
      discover: "fail",
      "routing-headers": "fail",
      "session-independence": "fail",
      // SDK 1.21 already backported the -32602 renumbering, so this passes even
      // an old-spec server — the check only catches genuinely old error tables.
      "error-codes": "pass",
      "cache-metadata": "warn",
      mrtr: "warn",
      "deprecated-features": "warn",
      "auth-metadata": "skipped",
    },
  },
  "auth-walled": {
    url: AUTH_URL,
    exitCode: 2,
    grade: "?",
    readiness: "unknown",
    checks: {
      discover: "skipped",
      "routing-headers": "skipped",
      "session-independence": "skipped",
      "error-codes": "skipped",
      "cache-metadata": "skipped",
      mrtr: "skipped",
      "deprecated-features": "skipped",
      // runsWhenAuthWalled: runs on 401; no well-known served here → warn.
      "auth-metadata": "warn",
    },
  },
  // Reproduces the real-world "DeepWiki" case: answers the legacy `initialize`
  // (so preflight classifies it `open`) but rejects every actual probe with
  // -32600 Invalid Request. The core checks can't get a clean signal → they
  // report `inconclusive` (not warn), so the server drops below the decided
  // threshold → grade "?", exit 2 ("couldn't test"), rather than a misleading
  // middling grade with exit 0. deprecated-features still passes because the
  // initialize fallback exposes an (empty) capabilities object.
  "ambiguous -32600": {
    url: AMBIG_URL,
    exitCode: 2,
    grade: "?",
    readiness: "unknown",
    checks: {
      discover: "inconclusive",
      "routing-headers": "inconclusive",
      "session-independence": "inconclusive",
      "error-codes": "inconclusive",
      "cache-metadata": "inconclusive",
      mrtr: "inconclusive",
      "deprecated-features": "pass",
      "auth-metadata": "skipped",
    },
  },
};

function startAuthServer(): Server {
  const server = createServer((_req, res) => {
    res.writeHead(401, {
      "content-type": "application/json",
      "www-authenticate": 'Bearer realm="mcp"',
    });
    res.end(JSON.stringify({ error: "unauthorized" }));
  });
  server.listen(AUTH_PORT, "127.0.0.1");
  return server;
}

/**
 * An endpoint that answers the legacy `initialize` (so preflight sees an open,
 * 2025-11-25 server) but rejects every actual probe with JSON-RPC -32600
 * (Invalid Request) — the pathological "ambiguous transport" case observed live
 * on DeepWiki. Every core check gets an undecidable response → `inconclusive`.
 */
function startAmbiguousServer(): Server {
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      // GET (e.g. /.well-known/oauth-protected-resource) → 404 so auth-metadata
      // finds no document on this open endpoint and skips.
      if (req.method !== "POST") {
        res.writeHead(404).end();
        return;
      }
      let method: unknown;
      let id: unknown = null;
      try {
        const msg = JSON.parse(raw || "{}") as { method?: unknown; id?: unknown };
        method = msg.method;
        id = msg.id ?? null;
      } catch {
        /* leave method undefined → falls through to the -32600 rejection */
      }
      const headers = { "content-type": "application/json" };
      const body =
        method === "initialize"
          ? {
              jsonrpc: "2.0",
              id,
              result: {
                protocolVersion: "2025-11-25",
                capabilities: {},
                serverInfo: { name: "ambiguous", version: "0" },
              },
            }
          : { jsonrpc: "2.0", id, error: { code: -32600, message: "Invalid Request" } };
      res.writeHead(200, headers).end(JSON.stringify(body));
    });
  });
  server.listen(AMBIG_PORT, "127.0.0.1");
  return server;
}

function spawnRefServer(script: string): ChildProcess {
  return spawn("npx", ["tsx", join("ref-servers", script)], {
    cwd: ROOT,
    stdio: "ignore",
    env: process.env,
  });
}

async function waitForReady(url: string, label: string, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      // Any HTTP response (even 400/401) means the port is serving.
      void res.status;
      return;
    } catch {
      await sleep(300);
    }
  }
  throw new Error(`${label} did not become ready at ${url} within ${timeoutMs}ms`);
}

interface CliRun {
  exitCode: number;
  report: {
    grade: string;
    readiness: Readiness;
    results: Array<{ id: string; status: Status; detail: string }>;
  };
}

function runCli(url: string): Promise<CliRun> {
  return new Promise((resolve, reject) => {
    const child = spawn("npx", ["tsx", join("src", "index.ts"), url, "--json"], {
      cwd: ROOT,
      env: process.env,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", reject);
    child.on("close", (code) => {
      try {
        resolve({ exitCode: code ?? -1, report: JSON.parse(stdout) });
      } catch (err) {
        reject(new Error(`couldn't parse CLI JSON for ${url}: ${String(err)}\nstdout:\n${stdout}\nstderr:\n${stderr}`));
      }
    });
  });
}

const GREEN = (s: string) => `\x1b[32m${s}\x1b[0m`;
const RED = (s: string) => `\x1b[31m${s}\x1b[0m`;
const DIM = (s: string) => `\x1b[2m${s}\x1b[0m`;

async function main(): Promise<void> {
  const auth = startAuthServer();
  const ambig = startAmbiguousServer();
  const old = spawnRefServer("old-server.ts");
  const rc = spawnRefServer("rc-server.ts");

  let failures = 0;
  try {
    await Promise.all([
      waitForReady(OLD_URL, "old-server"),
      waitForReady(RC_URL, "rc-server"),
      waitForReady(AUTH_URL, "auth-server"),
      waitForReady(AMBIG_URL, "ambiguous-server"),
    ]);

    for (const [label, exp] of Object.entries(EXPECTED)) {
      const run = await runCli(exp.url);
      const byId = new Map(run.report.results.map((r) => [r.id, r]));
      const rows: string[] = [];
      let scenarioFailed = false;

      const note = (ok: boolean, what: string) => {
        if (!ok) scenarioFailed = true;
        rows.push(`    ${ok ? GREEN("✓") : RED("✗")} ${what}`);
      };

      for (const [id, want] of Object.entries(exp.checks)) {
        const got = byId.get(id);
        note(got?.status === want, `${id}: expected ${want}, got ${got?.status ?? "MISSING"}`);
      }
      note(
        run.report.readiness === exp.readiness,
        `readiness: expected ${exp.readiness}, got ${run.report.readiness}`,
      );
      note(run.report.grade === exp.grade, `grade: expected ${exp.grade}, got ${run.report.grade}`);
      note(run.exitCode === exp.exitCode, `exit code: expected ${exp.exitCode}, got ${run.exitCode}`);

      console.log(`\n${scenarioFailed ? RED("✗") : GREEN("✓")} ${label} ${DIM(exp.url)}`);
      for (const row of rows) console.log(row);
      if (scenarioFailed) failures++;
    }
  } finally {
    old.kill();
    rc.kill();
    auth.close();
    ambig.close();
  }

  console.log("");
  if (failures > 0) {
    console.log(RED(`verify-refs: ${failures} scenario(s) failed`));
    process.exit(1);
  }
  console.log(GREEN("verify-refs: all scenarios match the expected matrix"));
  process.exit(0);
}

main().catch((err) => {
  console.error("verify-refs fatal:", err);
  process.exit(1);
});
