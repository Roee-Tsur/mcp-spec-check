import { describe, expect, it } from "vitest";
import { grade, summarize, exitCode, buildReport, readiness } from "../src/report.js";
import type { CheckResult, Preflight } from "../src/types.js";

const r = (status: CheckResult["status"]): CheckResult => ({
  id: "x",
  title: "x",
  status,
  detail: "",
});

/** A result with a specific check id — for readiness, which keys off the required-3 ids. */
const ri = (id: string, status: CheckResult["status"]): CheckResult => ({
  id,
  title: id,
  status,
  detail: "",
});
const required = (a: CheckResult["status"], b: CheckResult["status"], c: CheckResult["status"]) => [
  ri("discover", a),
  ri("routing-headers", b),
  ri("session-independence", c),
];

const open: Preflight = { access: "open", baseline: "2025-11-25", detail: "speaks 2025-11-25" };
const authWalled: Preflight = { access: "auth-required", detail: "HTTP 401" };
const notMcp: Preflight = { access: "not-mcp", detail: "HTTP 404" };
const unreachable: Preflight = { access: "unreachable", detail: "fetch failed" };

describe("grade", () => {
  it("returns ? when nothing is decided", () => {
    expect(grade([r("todo"), r("error")])).toBe("?");
  });
  it("returns ? below the minimum decided-check count (1 or 2 decided)", () => {
    expect(grade([r("pass")])).toBe("?");
    expect(grade([r("pass"), r("pass")])).toBe("?");
  });
  it("returns A for all pass (≥3 decided)", () => {
    expect(grade([r("pass"), r("pass"), r("pass")])).toBe("A");
  });
  it("returns F for all fail (≥3 decided)", () => {
    expect(grade([r("fail"), r("fail"), r("fail")])).toBe("F");
  });
  it("counts warn as half", () => {
    // 2 pass + 1 warn = 2.5/3 = 0.833 → B
    expect(grade([r("pass"), r("pass"), r("warn")])).toBe("B");
  });
  it("ignores todo checks in the score", () => {
    expect(grade([r("pass"), r("pass"), r("pass"), r("todo"), r("todo")])).toBe("A");
  });
  it("ignores skipped checks in the score", () => {
    expect(grade([r("pass"), r("pass"), r("pass"), r("skipped"), r("skipped")])).toBe("A");
  });
  it("ignores inconclusive checks in the score (like skipped)", () => {
    expect(grade([r("pass"), r("pass"), r("pass"), r("inconclusive"), r("inconclusive")])).toBe("A");
  });
  it("returns ? when everything is skipped (no F for auth-walled servers)", () => {
    expect(grade([r("skipped"), r("skipped")])).toBe("?");
  });
  it("returns ? when mostly inconclusive (couldn't probe — the DeepWiki case)", () => {
    expect(grade([r("pass"), r("inconclusive"), r("inconclusive"), r("inconclusive")])).toBe("?");
  });
  it("returns ? for a lone decided check (auth-walled: only auth-metadata ran)", () => {
    expect(grade([r("pass"), r("skipped"), r("skipped"), r("skipped")])).toBe("?");
  });
});

describe("exit codes", () => {
  it("0 when open, gradeable, and nothing fails", () => {
    expect(exitCode(buildReport("u", "0", open, [r("pass"), r("pass"), r("pass"), r("warn"), r("todo")]))).toBe(0);
  });
  it("2 when open but too few decided to assess (? grade — e.g. mostly inconclusive)", () => {
    expect(exitCode(buildReport("u", "0", open, [r("pass"), r("inconclusive"), r("inconclusive")]))).toBe(2);
  });
  it("1 on any fail", () => {
    expect(exitCode(buildReport("u", "0", open, [r("pass"), r("fail")]))).toBe(1);
  });
  it("2 on probe error", () => {
    expect(exitCode(buildReport("u", "0", open, [r("fail"), r("error")]))).toBe(2);
  });
  it("2 when auth-walled, even with all checks skipped", () => {
    expect(exitCode(buildReport("u", "0", authWalled, [r("skipped"), r("skipped")]))).toBe(2);
  });
  it("2 when not-mcp", () => {
    expect(exitCode(buildReport("u", "0", notMcp, [r("skipped")]))).toBe(2);
  });
  it("2 when unreachable", () => {
    expect(exitCode(buildReport("u", "0", unreachable, [r("skipped")]))).toBe(2);
  });
  it("2 when not open, even if results would otherwise pass", () => {
    expect(exitCode(buildReport("u", "0", authWalled, [r("pass"), r("pass")]))).toBe(2);
  });
});

describe("summarize", () => {
  it("counts by status", () => {
    const s = summarize([r("pass"), r("pass"), r("fail"), r("todo")]);
    expect(s).toEqual({ pass: 2, fail: 1, warn: 0, inconclusive: 0, todo: 1, error: 0, skipped: 0 });
  });
  it("counts skipped", () => {
    const s = summarize([r("skipped"), r("skipped"), r("pass")]);
    expect(s).toEqual({ pass: 1, fail: 0, warn: 0, inconclusive: 0, todo: 0, error: 0, skipped: 2 });
  });
  it("counts inconclusive", () => {
    const s = summarize([r("inconclusive"), r("inconclusive"), r("pass"), r("skipped")]);
    expect(s).toEqual({ pass: 1, fail: 0, warn: 0, inconclusive: 2, todo: 0, error: 0, skipped: 1 });
  });
});

describe("readiness", () => {
  it("ready when all three required checks pass", () => {
    expect(readiness(required("pass", "pass", "pass"))).toBe("ready");
  });
  it("ready even when optional checks warn/fail — required-3 only", () => {
    expect(readiness([...required("pass", "pass", "pass"), ri("cache-metadata", "warn")])).toBe("ready");
  });
  it("not-ready when any required check fails", () => {
    expect(readiness(required("fail", "pass", "pass"))).toBe("not-ready");
    expect(readiness(required("pass", "pass", "fail"))).toBe("not-ready");
  });
  it("a required fail dominates a required inconclusive", () => {
    expect(readiness(required("fail", "inconclusive", "pass"))).toBe("not-ready");
  });
  it("unknown when a required check is inconclusive (no fails)", () => {
    expect(readiness(required("pass", "inconclusive", "pass"))).toBe("unknown");
  });
  it("unknown when required checks are skipped (auth-walled)", () => {
    expect(readiness(required("skipped", "skipped", "skipped"))).toBe("unknown");
  });
  it("unknown when a required check is warn (e.g. discover works but omits the target)", () => {
    expect(readiness(required("warn", "pass", "pass"))).toBe("unknown");
  });
  it("unknown when a required check is missing entirely", () => {
    expect(readiness([ri("discover", "pass"), ri("routing-headers", "pass")])).toBe("unknown");
  });
});

describe("buildReport", () => {
  it("carries the preflight through to the report", () => {
    const report = buildReport("u", "0", authWalled, [r("skipped")]);
    expect(report.preflight).toEqual(authWalled);
    expect(report.grade).toBe("?");
  });
  it("sets readiness on the report", () => {
    expect(buildReport("u", "0", open, required("pass", "pass", "pass")).readiness).toBe("ready");
    expect(buildReport("u", "0", open, required("fail", "pass", "pass")).readiness).toBe("not-ready");
    expect(buildReport("u", "0", authWalled, [r("skipped")]).readiness).toBe("unknown");
  });
  it("attaches protocol facts only when provided", () => {
    expect(buildReport("u", "0", open, required("pass", "pass", "pass")).protocol).toBeUndefined();
    const withProto = buildReport("u", "0", open, required("pass", "pass", "pass"), {
      transportMode: "next",
      declaredVersions: ["2026-07-28"],
    });
    expect(withProto.protocol).toEqual({ transportMode: "next", declaredVersions: ["2026-07-28"] });
  });
});
