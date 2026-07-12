import { describe, expect, it } from "vitest";
import {
  buildTargets,
  isActiveLatest,
  isJunkUrl,
  normalizeUrl,
  type RegistryEntry,
} from "../scan/registry.js";

const OFFICIAL = "io.modelcontextprotocol.registry/official";

/** A real-shape registry entry. */
function entry(
  name: string,
  remotes: Array<{ type?: string; url?: string }>,
  meta: { status?: string; isLatest?: boolean } = { status: "active", isLatest: true },
): RegistryEntry {
  return {
    server: { name, version: "1.0.0", remotes },
    _meta: { [OFFICIAL]: meta },
  };
}

describe("isJunkUrl", () => {
  it("rejects {host} / {port} template placeholders", () => {
    expect(isJunkUrl("https://{host}/mcp")).toBe(true);
    expect(isJunkUrl("https://api.example-real.com:{port}/mcp")).toBe(true);
  });
  it("rejects localhost, loopback, link-local and private ranges", () => {
    expect(isJunkUrl("http://localhost:3000/mcp")).toBe(true);
    expect(isJunkUrl("http://127.0.0.1/mcp")).toBe(true);
    expect(isJunkUrl("http://10.0.0.5/mcp")).toBe(true);
    expect(isJunkUrl("http://192.168.1.10/mcp")).toBe(true);
    expect(isJunkUrl("http://172.16.4.4/mcp")).toBe(true);
    expect(isJunkUrl("http://169.254.1.1/mcp")).toBe(true);
    expect(isJunkUrl("http://0.0.0.0/mcp")).toBe(true);
  });
  it("rejects example.* documentation domains", () => {
    expect(isJunkUrl("https://example.com/mcp")).toBe(true);
    expect(isJunkUrl("https://foo.example.org/mcp")).toBe(true);
  });
  it("rejects non-http(s), unparseable and empty", () => {
    expect(isJunkUrl("ftp://host/mcp")).toBe(true);
    expect(isJunkUrl("stdio://local")).toBe(true);
    expect(isJunkUrl("not a url")).toBe(true);
    expect(isJunkUrl("")).toBe(true);
    expect(isJunkUrl(undefined)).toBe(true);
  });
  it("keeps ephemeral tunnels and normal endpoints (they land honestly in unreachable)", () => {
    expect(isJunkUrl("https://abc-123.trycloudflare.com/mcp")).toBe(false);
    expect(isJunkUrl("https://api.githubcopilot.com/mcp/")).toBe(false);
    expect(isJunkUrl("http://10-a-host.example-real.com/mcp")).toBe(false); // "10" only in a label, not an IP
  });
});

describe("normalizeUrl", () => {
  it("lowercases host, drops default ports, strips trailing slash and fragment", () => {
    expect(normalizeUrl("HTTPS://API.Example-Real.com:443/mcp/")).toBe("https://api.example-real.com/mcp");
    expect(normalizeUrl("http://Host.com:80/mcp")).toBe("http://host.com/mcp");
    expect(normalizeUrl("https://host.com/mcp#frag")).toBe("https://host.com/mcp");
    expect(normalizeUrl("https://host.com")).toBe("https://host.com");
  });
  it("keeps non-default ports and query strings", () => {
    expect(normalizeUrl("https://host.com:8443/mcp?x=1")).toBe("https://host.com:8443/mcp?x=1");
  });
});

describe("isActiveLatest", () => {
  it("true only for active + isLatest", () => {
    expect(isActiveLatest(entry("a", [], { status: "active", isLatest: true }))).toBe(true);
    expect(isActiveLatest(entry("a", [], { status: "deleted", isLatest: true }))).toBe(false);
    expect(isActiveLatest(entry("a", [], { status: "active", isLatest: false }))).toBe(false);
    expect(isActiveLatest({ server: { name: "x" } })).toBe(false);
  });
});

describe("buildTargets", () => {
  it("filters to active+latest, flattens remotes, and counts the funnel", () => {
    const entries: RegistryEntry[] = [
      entry("a/one", [{ type: "streamable-http", url: "https://a.com/mcp" }]),
      entry("a/two", [{ type: "sse", url: "https://b.com/sse" }]),
      entry("inactive", [{ type: "streamable-http", url: "https://c.com/mcp" }], {
        status: "deleted",
        isLatest: true,
      }),
      entry("notlatest", [{ type: "streamable-http", url: "https://d.com/mcp" }], {
        status: "active",
        isLatest: false,
      }),
    ];
    const { targets, funnel } = buildTargets(entries);
    expect(funnel.totalEntries).toBe(4);
    expect(funnel.activeLatest).toBe(2);
    expect(funnel.withRemotes).toBe(2);
    expect(funnel.uniqueUrls).toBe(2);
    expect(funnel.uniqueHosts).toBe(2);
    expect(funnel.byDeclaredType).toEqual({ "streamable-http": 1, sse: 1 });
    expect(targets.map((t) => t.url).sort()).toEqual(["https://a.com/mcp", "https://b.com/sse"]);
  });

  it("junk-filters and counts dropped URLs", () => {
    const entries = [
      entry("good", [{ type: "streamable-http", url: "https://real.com/mcp" }]),
      entry("junk", [
        { type: "streamable-http", url: "https://{host}/mcp" },
        { type: "streamable-http", url: "http://localhost/mcp" },
      ]),
    ];
    const { targets, funnel } = buildTargets(entries);
    expect(funnel.remoteUrls).toBe(3);
    expect(funnel.junkUrls).toBe(2);
    expect(funnel.uniqueUrls).toBe(1);
    expect(targets).toHaveLength(1);
  });

  it("dedups by normalized URL, merging names and declared types", () => {
    const entries = [
      entry("owner/x", [{ type: "streamable-http", url: "https://Shared.com/mcp/" }]),
      entry("owner/y", [{ type: "sse", url: "https://shared.com/mcp" }]),
    ];
    const { targets, funnel } = buildTargets(entries);
    expect(funnel.remoteUrls).toBe(2);
    expect(funnel.uniqueUrls).toBe(1);
    const [t] = targets;
    expect(t?.url).toBe("https://shared.com/mcp");
    expect(t?.serverNames.sort()).toEqual(["owner/x", "owner/y"]);
    expect(t?.declaredTypes.sort()).toEqual(["sse", "streamable-http"]);
  });

  it("counts an entry once in withRemotes even with multiple remotes", () => {
    const { funnel } = buildTargets([
      entry("multi", [
        { type: "streamable-http", url: "https://one.com/mcp" },
        { type: "streamable-http", url: "https://two.com/mcp" },
      ]),
    ]);
    expect(funnel.withRemotes).toBe(1);
    expect(funnel.remoteUrls).toBe(2);
    expect(funnel.uniqueUrls).toBe(2);
  });
});
