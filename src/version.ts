/**
 * Single source of truth for the tool version. Read from package.json at module
 * load so `npm version` (which bumps package.json only) propagates everywhere —
 * the `--version` output, the report's toolVersion, and the clientInfo identity
 * mcp-spec-check presents to every probed server.
 *
 * The relative URL resolves in all three execution contexts: the published
 * tarball (dist/version.js → ../package.json = package root; npm always ships
 * package.json), tsx dev runs, and vitest (repo root). Reading at runtime avoids
 * JSON import attributes and tsconfig rootDir violations, and keeps the root
 * zero-dependency (node:fs is a builtin).
 */
import { readFileSync } from "node:fs";

const pkg = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { version: string };

export const VERSION: string = pkg.version;

/** Identity mcp-spec-check presents in the _meta clientInfo of every request. */
export const CLIENT_INFO = { name: "mcp-spec-check", version: VERSION } as const;

/** Repository URL, embedded in the User-Agent so probed hosts can find who's probing. */
export const REPO_URL = "https://github.com/Roee-Tsur/mcp-spec-check";

/**
 * Default User-Agent on every probe request. Node's fetch otherwise sends
 * `node`, which is opaque to a server operator inspecting their logs — a named,
 * repo-linked UA is the polite default (and the scan overrides it with its own
 * scan-specific UA via ctx.headers). Lowercased so a caller-supplied
 * `user-agent` in opts.headers cleanly overrides it.
 */
export const USER_AGENT = `mcp-spec-check/${VERSION} (+${REPO_URL})`;
