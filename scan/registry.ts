/**
 * Pure registry-shaping helpers: turn raw MCP registry entries into a deduped
 * list of remote URLs to probe, emitting a funnel count at every step so the
 * writeup can publish honest denominators (rule 9). No network, no fs — unit
 * tested against real-shape fixtures.
 *
 * The registry API (https://registry.modelcontextprotocol.io/v0/servers) returns
 * one object per published version; `?version=latest` filters server-side to the
 * latest of each, but we still re-check status/isLatest defensively. Each entry
 * may declare several `remotes` (streamable-http / sse), each with a URL — many
 * of which repeat across entries (5,608 hosts behind 7,957 URLs), so we dedup by
 * normalized URL and keep the concentration visible.
 */

/** The official-registry status block, under a namespaced _meta key. */
const OFFICIAL_META_KEY = "io.modelcontextprotocol.registry/official";

export interface RegistryRemote {
  type?: string;
  url?: string;
}

export interface RegistryEntry {
  server?: {
    name?: string;
    version?: string;
    remotes?: RegistryRemote[];
    [k: string]: unknown;
  };
  _meta?: Record<string, unknown>;
}

interface OfficialMeta {
  status?: string;
  isLatest?: boolean;
}

export function officialMeta(entry: RegistryEntry): OfficialMeta | undefined {
  const meta = entry._meta?.[OFFICIAL_META_KEY];
  return typeof meta === "object" && meta !== null ? (meta as OfficialMeta) : undefined;
}

/** An entry we count as live: officially active and the latest published version. */
export function isActiveLatest(entry: RegistryEntry): boolean {
  const m = officialMeta(entry);
  return m?.status === "active" && m?.isLatest === true;
}

/**
 * Reject URLs that aren't real, reachable, public MCP endpoints:
 *  - unparseable / non-http(s)
 *  - template placeholders (the 17 literal `{host}` URLs seen live)
 *  - localhost / loopback / link-local / private RFC 1918 ranges
 *  - example.* documentation domains
 * Ephemeral tunnels (*.trycloudflare.com) are deliberately NOT junk — they stay
 * in the denominator and land honestly in `unreachable` when probed.
 */
export function isJunkUrl(raw: unknown): boolean {
  if (typeof raw !== "string" || raw.trim() === "") return true;
  if (raw.includes("{") || raw.includes("}")) return true; // {host} / {port} templates
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return true;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return true;
  const host = u.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host === "0.0.0.0" || host === "::1" || host === "[::1]") return true;
  if (
    host === "example.com" ||
    host === "example.org" ||
    host === "example.net" ||
    host.endsWith(".example.com") ||
    host.endsWith(".example.org") ||
    host.endsWith(".example.net") ||
    host.endsWith(".example")
  ) {
    return true;
  }
  if (/^127\./.test(host)) return true;
  if (/^10\./.test(host)) return true;
  if (/^192\.168\./.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
  if (/^169\.254\./.test(host)) return true; // link-local
  return false;
}

/**
 * Canonical form for dedup: lowercase scheme+host, drop default ports and the
 * fragment, strip a single trailing slash. Same endpoint written two ways
 * collapses to one target (and one probe).
 */
export function normalizeUrl(raw: string): string {
  const u = new URL(raw);
  u.hash = "";
  if ((u.protocol === "http:" && u.port === "80") || (u.protocol === "https:" && u.port === "443")) {
    u.port = "";
  }
  // URL lowercases scheme + host already; toString() re-adds a trailing "/".
  return u.toString().replace(/\/$/, "");
}

export interface Target {
  /** Normalized URL — the probe target and the dedup key. */
  url: string;
  /** Hostname (no port) — the serial-queue key for polite, per-host probing. */
  host: string;
  /** Declared transport types across the entries that referenced this URL. */
  declaredTypes: string[];
  /** Registry entry names that referenced this URL (local only — never published). */
  serverNames: string[];
}

export interface Funnel {
  /** Every entry fetched from the registry. */
  totalEntries: number;
  /** Entries that are officially active AND the latest version. */
  activeLatest: number;
  /** Active+latest entries declaring at least one remote. */
  withRemotes: number;
  /** Remote URL slots across those entries (before junk-filtering / dedup). */
  remoteUrls: number;
  /** URL slots dropped by isJunkUrl. */
  junkUrls: number;
  /** Distinct probe targets after dedup. */
  uniqueUrls: number;
  /** Distinct hosts among the unique targets. */
  uniqueHosts: number;
  /** Unique targets bucketed by primary declared transport type. */
  byDeclaredType: Record<string, number>;
}

/**
 * The whole registry → targets pipeline as one pure function: filter to
 * active+latest, flatten remotes, drop junk, dedup by normalized URL (merging
 * the declared types and referencing names), and record a count at each step.
 */
export function buildTargets(entries: RegistryEntry[]): { targets: Target[]; funnel: Funnel } {
  const active = entries.filter(isActiveLatest);

  let withRemotes = 0;
  let remoteUrls = 0;
  let junkUrls = 0;
  const byUrl = new Map<string, Target>();

  for (const entry of active) {
    const remotes = entry.server?.remotes;
    if (!Array.isArray(remotes) || remotes.length === 0) continue;
    let counted = false;
    for (const remote of remotes) {
      const url = remote?.url;
      if (typeof url !== "string" || url.trim() === "") continue;
      remoteUrls++;
      if (!counted) {
        withRemotes++;
        counted = true;
      }
      if (isJunkUrl(url)) {
        junkUrls++;
        continue;
      }
      const normalized = normalizeUrl(url);
      const host = new URL(normalized).hostname.toLowerCase();
      const existing = byUrl.get(normalized);
      const type = typeof remote.type === "string" ? remote.type : "unknown";
      const name = typeof entry.server?.name === "string" ? entry.server.name : "";
      if (existing) {
        if (!existing.declaredTypes.includes(type)) existing.declaredTypes.push(type);
        if (name && !existing.serverNames.includes(name)) existing.serverNames.push(name);
      } else {
        byUrl.set(normalized, {
          url: normalized,
          host,
          declaredTypes: [type],
          serverNames: name ? [name] : [],
        });
      }
    }
  }

  const targets = [...byUrl.values()];
  const byDeclaredType: Record<string, number> = {};
  const hosts = new Set<string>();
  for (const t of targets) {
    hosts.add(t.host);
    const primary = t.declaredTypes[0] ?? "unknown";
    byDeclaredType[primary] = (byDeclaredType[primary] ?? 0) + 1;
  }

  return {
    targets,
    funnel: {
      totalEntries: entries.length,
      activeLatest: active.length,
      withRemotes,
      remoteUrls,
      junkUrls,
      uniqueUrls: targets.length,
      uniqueHosts: hosts.size,
      byDeclaredType,
    },
  };
}

/** Group targets by host for the serial-queue scheduler. */
export function groupByHost(targets: Target[]): Map<string, Target[]> {
  const byHost = new Map<string, Target[]>();
  for (const t of targets) {
    const list = byHost.get(t.host);
    if (list) list.push(t);
    else byHost.set(t.host, [t]);
  }
  return byHost;
}
