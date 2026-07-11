import { describe, expect, it } from "vitest";
import { grade, summarize, exitCode, buildReport } from "../src/report.js";
import type { CheckResult, Preflight } from "../src/types.js";

const r = (status: CheckResult["status"]): CheckResult => ({
  id: "x",
  title: "x",
  status,
  detail: "",
});

const open: Preflight = { access: "open", baseline: "2025-11-25", detail: "speaks 2025-11-25" };
const authWalled: Preflight = { access: "auth-required", detail: "HTTP 401" };
const notMcp: Preflight = { access: "not-mcp", detail: "HTTP 404" };
const unreachable: Preflight = { access: "unreachable", detail: "fetch failed" };

describe("grade", () => {
  it("returns ? when nothing is decided", () => {
    expect(grade([r("todo"), r("error")])).toBe("?");
  });
  it("returns A for all pass", () => {
    expect(grade([r("pass"), r("pass")])).toBe("A");
  });
  it("returns F for all fail", () => {
    expect(grade([r("fail"), r("fail")])).toBe("F");
  });
  it("counts warn as half", () => {
    // 1 pass + 1 warn = 1.5/2 = 0.75 → B
    expect(grade([r("pass"), r("warn")])).toBe("B");
  });
  it("ignores todo checks in the score", () => {
    expect(grade([r("pass"), r("todo"), r("todo")])).toBe("A");
  });
  it("ignores skipped checks in the score", () => {
    expect(grade([r("pass"), r("skipped"), r("skipped")])).toBe("A");
  });
  it("returns ? when everything is skipped (no F for auth-walled servers)", () => {
    expect(grade([r("skipped"), r("skipped")])).toBe("?");
  });
});

describe("exit codes", () => {
  it("0 when open and nothing fails", () => {
    expect(exitCode(buildReport("u", "0", open, [r("pass"), r("warn"), r("todo")]))).toBe(0);
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
    expect(s).toEqual({ pass: 2, fail: 1, warn: 0, todo: 1, error: 0, skipped: 0 });
  });
  it("counts skipped", () => {
    const s = summarize([r("skipped"), r("skipped"), r("pass")]);
    expect(s).toEqual({ pass: 1, fail: 0, warn: 0, todo: 0, error: 0, skipped: 2 });
  });
});

describe("buildReport", () => {
  it("carries the preflight through to the report", () => {
    const report = buildReport("u", "0", authWalled, [r("skipped")]);
    expect(report.preflight).toEqual(authWalled);
    expect(report.grade).toBe("?");
  });
});
