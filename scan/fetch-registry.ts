/**
 * Phase B step 1: page through the official MCP registry, snapshot every
 * active+latest entry, and derive the deduped target list + funnel. Writes
 * registry-snapshot.json, targets.json, and snapshot-funnel.json under the run
 * directory. Idempotent per date; safe to re-run.
 *
 * Politeness + honesty: a named scan User-Agent, per-page retry with backoff
 * (live fetches already hit ETIMEDOUT), and a bounded page cap so a registry
 * bug can't spin forever.
 */
import { writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { REPO_URL, VERSION } from "../src/version.js";
import { buildTargets, type RegistryEntry } from "./registry.js";
import { ensureRunDirs, isMain, resolveRunDate, runPaths } from "./paths.js";

const REGISTRY_URL = "https://registry.modelcontextprotocol.io/v0/servers";
const PAGE_LIMIT = 100;
const MAX_PAGES = 400; // ~162 pages expected; a generous ceiling against runaway loops
const SCAN_UA = `mcp-spec-check-scan/${VERSION} (+${REPO_URL})`;

interface RegistryPage {
  servers?: RegistryEntry[];
  metadata?: { nextCursor?: string; count?: number };
}

async function fetchPage(cursor: string | undefined, timeoutMs: number): Promise<RegistryPage> {
  const url = new URL(REGISTRY_URL);
  url.searchParams.set("limit", String(PAGE_LIMIT));
  url.searchParams.set("version", "latest");
  if (cursor) url.searchParams.set("cursor", cursor);

  let lastErr: unknown;
  for (let attempt = 1; attempt <= 5; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { accept: "application/json", "user-agent": SCAN_UA },
      });
      if (!res.ok) throw new Error(`registry HTTP ${res.status}`);
      return (await res.json()) as RegistryPage;
    } catch (err) {
      lastErr = err;
      const backoff = Math.min(1000 * 2 ** (attempt - 1), 15_000);
      process.stderr.write(`  page fetch attempt ${attempt} failed (${String(err)}); retrying in ${backoff}ms\n`);
      await sleep(backoff);
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`registry page fetch failed after retries: ${String(lastErr)}`);
}

export async function fetchAllEntries(timeoutMs = 30_000): Promise<RegistryEntry[]> {
  const entries: RegistryEntry[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const data = await fetchPage(cursor, timeoutMs);
    const servers = Array.isArray(data.servers) ? data.servers : [];
    entries.push(...servers);
    process.stdout.write(`  page ${page + 1}: +${servers.length} (total ${entries.length})\n`);
    cursor = data.metadata?.nextCursor;
    if (!cursor || servers.length === 0) break;
  }
  return entries;
}

export interface FetchResult {
  date: string;
  entries: number;
  targets: number;
}

export async function fetchRegistry(date = resolveRunDate("new")): Promise<FetchResult> {
  const p = runPaths(date);
  ensureRunDirs(p);
  process.stdout.write(`Fetching registry snapshot → ${p.dir}\n`);

  const entries = await fetchAllEntries();
  writeFileSync(p.registrySnapshot, JSON.stringify(entries));

  const { targets, funnel } = buildTargets(entries);
  writeFileSync(p.targets, JSON.stringify(targets, null, 2));
  writeFileSync(p.funnel, JSON.stringify(funnel, null, 2));

  process.stdout.write(
    `\nFunnel: ${funnel.totalEntries} entries → ${funnel.activeLatest} active+latest → ` +
      `${funnel.withRemotes} with remotes → ${funnel.remoteUrls} remote URLs ` +
      `(− ${funnel.junkUrls} junk) → ${funnel.uniqueUrls} unique targets across ${funnel.uniqueHosts} hosts\n` +
      `Declared types: ${JSON.stringify(funnel.byDeclaredType)}\n`,
  );
  return { date, entries: entries.length, targets: targets.length };
}

if (isMain(import.meta.url)) {
  fetchRegistry().catch((err) => {
    console.error("fetch-registry fatal:", err);
    process.exit(1);
  });
}
