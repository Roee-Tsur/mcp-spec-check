import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CLIENT_INFO, VERSION } from "../src/version.js";

/**
 * Guards the single-source-of-truth wiring: VERSION must track package.json so
 * `npm version` propagates, and the relative-path read must resolve (a broken
 * path would ship `undefined`, not fail loudly). Read package.json independently
 * here rather than trusting the same module under test.
 */
const pkg = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { version: string };

describe("version", () => {
  it("tracks the package.json version", () => {
    expect(VERSION).toBe(pkg.version);
  });

  it("is a semver string", () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("carries the version into the probed-server clientInfo identity", () => {
    expect(CLIENT_INFO).toEqual({ name: "mcp-spec-check", version: VERSION });
  });
});
