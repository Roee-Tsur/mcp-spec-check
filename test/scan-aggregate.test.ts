import { describe, expect, it } from "vitest";
import { aggregate, newestDemonstratedVersion, redactHostNames } from "../scan/aggregate.js";
import { urlHash } from "../scan/paths.js";
import type { Funnel } from "../scan/registry.js";
import type { Envelope, ProbeOutcome } from "../scan/types.js";
import type { TransportMode } from "../src/probe-transport.js";
import type { Access, CheckStatus, Readiness, Report } from "../src/types.js";

interface ReportOpts {
  access?: Access;
  readiness?: Readiness;
  checks?: Record<string, CheckStatus>;
  baseline?: string;
  transportMode?: TransportMode;
  declaredVersions?: string[];
}

function mkReport(o: ReportOpts): Report {
  const results = Object.entries(o.checks ?? {}).map(([id, status]) => ({ id, title: id, status, detail: "" }));
  const protocol =
    o.transportMode || o.declaredVersions
      ? { ...(o.transportMode ? { transportMode: o.transportMode } : {}), ...(o.declaredVersions ? { declaredVersions: o.declaredVersions } : {}) }
      : undefined;
  return {
    url: "x",
    timestamp: "t",
    toolVersion: "0.2.0",
    targetSpec: "2026-07-28",
    preflight: { access: o.access ?? "open", ...(o.baseline ? { baseline: o.baseline } : {}), detail: "" },
    results,
    readiness: o.readiness ?? "unknown",
    ...(protocol ? { protocol } : {}),
    grade: "?",
    summary: { pass: 0, fail: 0, warn: 0, inconclusive: 0, todo: 0, error: 0, skipped: 0 },
  };
}

function env(url: string, report?: Report, outcome: ProbeOutcome = "ok", attempts = 1): Envelope {
  return {
    url,
    hash: urlHash(url),
    outcome,
    startedAt: "",
    finishedAt: "",
    attempts,
    ...(report ? { report } : {}),
    ...(outcome === "crash" ? { error: "boom" } : {}),
  };
}

const FUNNEL: Funnel = {
  totalEntries: 100,
  activeLatest: 90,
  withRemotes: 50,
  remoteUrls: 60,
  junkUrls: 5,
  uniqueUrls: 55,
  uniqueHosts: 40,
  byDeclaredType: { "streamable-http": 50, sse: 5 },
};

const META = { toolVersion: "0.2.0", date: "2026-07-15", generatedAt: "2026-07-15T00:00:00Z" };

describe("newestDemonstratedVersion", () => {
  it("2026-07-28 when discover passed", () => {
    expect(newestDemonstratedVersion(mkReport({ checks: { discover: "pass" } }))).toBe("2026-07-28");
  });
  it("2026-07-28 when the server enforced the new routing header (routing-headers pass)", () => {
    expect(newestDemonstratedVersion(mkReport({ checks: { discover: "inconclusive", "routing-headers": "pass" } }))).toBe("2026-07-28");
  });
  it("does NOT credit 2026-07-28 for an old stateless server that only passes session-independence", () => {
    // The 2,511-server trap: negotiates an OLD version via initialize, is
    // coincidentally stateless (session-independence pass), but implements no
    // distinctive 2026-07-28 surface → buckets to its real baseline.
    expect(
      newestDemonstratedVersion(
        mkReport({ baseline: "2025-03-26", checks: { discover: "fail", "routing-headers": "fail", "session-independence": "pass" } }),
      ),
    ).toBe("2025-03-26");
  });
  it("does NOT credit 2026-07-28 for a -32600 ambiguous server (next-transport but no success)", () => {
    // The DeepWiki pattern: legacy initialize (baseline 2025-11-25), everything
    // else -32600 → transport labels it "next" but it never served a result.
    expect(
      newestDemonstratedVersion(
        mkReport({ baseline: "2025-11-25", transportMode: "next", checks: { discover: "inconclusive", "session-independence": "inconclusive" } }),
      ),
    ).toBe("2025-11-25");
  });
  it("the legacy baseline when only initialize negotiated", () => {
    expect(newestDemonstratedVersion(mkReport({ baseline: "2025-11-25", checks: { discover: "fail" } }))).toBe("2025-11-25");
  });
  it("modern-undeclared when next-shaped but no result and no baseline", () => {
    expect(newestDemonstratedVersion(mkReport({ transportMode: "next", checks: { discover: "inconclusive" } }))).toBe("modern-undeclared");
  });
  it("unknown when nothing observable", () => {
    expect(newestDemonstratedVersion(mkReport({ checks: { discover: "inconclusive" } }))).toBe("unknown");
  });
});

describe("aggregate", () => {
  const envelopes: Envelope[] = [
    env("https://ready1.com/mcp", mkReport({ readiness: "ready", checks: { discover: "pass" }, transportMode: "next", declaredVersions: ["2026-07-28"] })),
    env("https://old1.com/mcp", mkReport({ readiness: "not-ready", checks: { discover: "fail" }, baseline: "2025-11-25" })),
    env("https://ambig1.com/mcp", mkReport({ readiness: "unknown", checks: { discover: "inconclusive" }, baseline: "2025-11-25" })),
    // A single host with three identical not-ready endpoints — the concentration case.
    env("https://gateway.pipeworx-example.com/a", mkReport({ readiness: "not-ready", checks: { discover: "fail" }, baseline: "2025-06-18" })),
    env("https://gateway.pipeworx-example.com/b", mkReport({ readiness: "not-ready", checks: { discover: "fail" }, baseline: "2025-06-18" })),
    env("https://gateway.pipeworx-example.com/c", mkReport({ readiness: "not-ready", checks: { discover: "fail" }, baseline: "2025-06-18" })),
    env("https://auth1.com/mcp", mkReport({ access: "auth-required", checks: { "auth-metadata": "pass" } })),
    env("https://auth2.com/mcp", mkReport({ access: "auth-required", checks: { "auth-metadata": "warn" } })),
    env("https://nm.com/x", mkReport({ access: "not-mcp" })),
    env("https://ur.com/x", mkReport({ access: "unreachable" })),
    env("https://crash.com/x", undefined, "crash"),
  ];
  const agg = aggregate(envelopes, FUNNEL, META);

  it("splits access over probed endpoints", () => {
    expect(agg.access).toEqual({ probed: 10, open: 6, authRequired: 2, notMcp: 1, unreachable: 1 });
    expect(agg.outcomes).toEqual({ ok: 10, budgetExceeded: 0, crash: 1 });
  });

  it("readiness endpoint-level counts every open server", () => {
    expect(agg.readiness.endpointLevel).toEqual({ total: 6, ready: 1, notReady: 4, unknown: 1 });
  });

  it("readiness host-collapsed gives the gateway one vote", () => {
    // 4 open hosts: ready1(ready), old1(not-ready), ambig1(unknown), gateway(not-ready x3 → 1 vote)
    expect(agg.readiness.hostCollapsed).toEqual({ total: 4, ready: 1, notReady: 2, unknown: 1 });
  });

  it("bucket versions both endpoint-level and host-collapsed", () => {
    expect(agg.versions.endpointLevel).toEqual({ "2026-07-28": 1, "2025-11-25": 2, "2025-06-18": 3 });
    expect(agg.versions.hostCollapsed).toEqual({ "2026-07-28": 1, "2025-11-25": 2, "2025-06-18": 1 });
  });

  it("measures RFC 9728 through the auth wall", () => {
    expect(agg.authWalledRfc9728).toEqual({ total: 2, withMetadata: 1, withoutMetadata: 1 });
  });

  it("redactHostNames drops identities but keeps shares/counts", () => {
    const red = redactHostNames(agg);
    expect(red.hostConcentration.topHosts[0]).toEqual({
      host: "host-01",
      urlCount: 3,
      sharePct: 27.3,
    });
    // shares and every non-host number are untouched
    expect(red.hostConcentration.topHostSharePct).toBe(agg.hostConcentration.topHostSharePct);
    expect(red.readiness).toEqual(agg.readiness);
    // no real host name survives anywhere in the redacted top-host list
    expect(red.hostConcentration.topHosts.some((h) => h.host.includes("."))).toBe(false);
  });

  it("reports host concentration without attaching readiness", () => {
    expect(agg.hostConcentration.uniqueHosts).toBe(9);
    expect(agg.hostConcentration.topHosts[0]).toEqual({
      host: "gateway.pipeworx-example.com",
      urlCount: 3,
      sharePct: 27.3,
    });
    // No readiness field leaks into the host table.
    expect(Object.keys(agg.hostConcentration.topHosts[0] ?? {})).toEqual(["host", "urlCount", "sharePct"]);
  });

  it("counts per-check status over open servers only", () => {
    expect(agg.checkStatusCounts["discover"]).toMatchObject({ pass: 1, fail: 4, inconclusive: 1 });
  });

  it("does not trip any tripwire on a healthy spread", () => {
    expect(agg.tripwires.filter((t) => t.tripped)).toHaveLength(0);
  });
});

describe("aggregate tripwires", () => {
  it("trips warn-only-fail when an optional check produces a fail", () => {
    const envelopes = [
      env("https://a.com/", mkReport({ checks: { discover: "pass", "cache-metadata": "fail" } })),
    ];
    const agg = aggregate(envelopes, FUNNEL, META);
    expect(agg.tripwires.map((t) => t.name)).toContain("warn-only-fail:cache-metadata");
  });

  it("trips inconclusive-rate when a check is inconclusive on >30% of open servers", () => {
    const envelopes = [
      env("https://a.com/", mkReport({ checks: { discover: "inconclusive" } })),
      env("https://b.com/", mkReport({ checks: { discover: "inconclusive" } })),
      env("https://c.com/", mkReport({ checks: { discover: "pass" } })),
    ];
    const agg = aggregate(envelopes, FUNNEL, META);
    const wire = agg.tripwires.find((t) => t.name === "inconclusive-rate:discover");
    expect(wire?.tripped).toBe(true);
    expect(wire?.sampleHashes.length).toBeGreaterThan(0);
  });

  it("trips error-rate when a check errors on >5% of open servers", () => {
    const envelopes = [
      env("https://a.com/", mkReport({ checks: { "routing-headers": "error" } })),
      env("https://b.com/", mkReport({ checks: { "routing-headers": "pass" } })),
    ];
    const agg = aggregate(envelopes, FUNNEL, META);
    expect(agg.tripwires.map((t) => t.name)).toContain("error-rate:routing-headers");
  });
});
