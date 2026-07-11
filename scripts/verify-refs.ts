/**
 * verify-refs — the live test oracle for mcp-ready (PLAN.md Milestone 1: "each
 * check verified against both reference servers before marking done").
 *
 * Spawns the two reference servers (old-spec 2025-11-25 + RC 2026-07-28) and a
 * tiny inline auth-walled endpoint, runs the real CLI end-to-end against each,
 * and asserts an expected per-check verdict matrix plus grade and exit code.
 * Exits non-zero on any mismatch.
 *
 * Run:  npm run verify:refs      (from repo root, under Node 22)
 *
 * Not wired into `npm test` — it needs ref-servers/ installed, which CI doesn't
 * have yet (deferred to Milestone 2).
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type Server } from "node:http";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

type Status = "pass" | "fail" | "warn" | "todo" | "error" | "skipped";

interface Expectation {
  url: string;
  exitCode: number;
  grade: string;
  checks: Record<string, Status>;
}

const OLD_URL = "http://127.0.0.1:7101/mcp";
const RC_URL = "http://127.0.0.1:7102/mcp";
const AUTH_PORT = 7103;
const AUTH_URL = `http://127.0.0.1:${AUTH_PORT}/mcp`;

const EXPECTED: Record<string, Expectation> = {
  "RC 2026-07-28": {
    url: RC_URL,
    exitCode: 0,
    grade: "A",
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
  const old = spawnRefServer("old-server.ts");
  const rc = spawnRefServer("rc-server.ts");

  let failures = 0;
  try {
    await Promise.all([
      waitForReady(OLD_URL, "old-server"),
      waitForReady(RC_URL, "rc-server"),
      waitForReady(AUTH_URL, "auth-server"),
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
