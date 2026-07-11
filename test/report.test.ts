import { describe, expect, it } from "vitest";
import { grade, summarize, exitCode, buildReport } from "../src/report.js";
import type { CheckResult } from "../src/types.js";

const r = (status: CheckResult["status"]): CheckResult => ({
  id: "x",
  title: "x",
  status,
  detail: "",
});

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
});

describe("exit codes", () => {
  it("0 when nothing fails", () => {
    expect(exitCode(buildReport("u", "0", [r("pass"), r("warn"), r("todo")]))).toBe(0);
  });
  it("1 on any fail", () => {
    expect(exitCode(buildReport("u", "0", [r("pass"), r("fail")]))).toBe(1);
  });
  it("2 on probe error", () => {
    expect(exitCode(buildReport("u", "0", [r("fail"), r("error")]))).toBe(2);
  });
});

describe("summarize", () => {
  it("counts by status", () => {
    const s = summarize([r("pass"), r("pass"), r("fail"), r("todo")]);
    expect(s).toEqual({ pass: 2, fail: 1, warn: 0, todo: 1, error: 0 });
  });
});
