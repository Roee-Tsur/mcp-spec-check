/**
 * Single source of truth for the tool version. Read from package.json at module
 * load so `npm version` (which bumps package.json only) propagates everywhere —
 * the `--version` output, the report's toolVersion, and the clientInfo identity
 * mcp-ready presents to every probed server.
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

/** Identity mcp-ready presents in the _meta clientInfo of every request. */
export const CLIENT_INFO = { name: "mcp-ready", version: VERSION } as const;
