import type { Transport, TransportMode } from "./probe-transport.js";

export type CheckStatus = "pass" | "fail" | "warn" | "inconclusive" | "todo" | "error" | "skipped";

export interface CheckResult {
  id: string;
  title: string;
  status: CheckStatus;
  /** One-line explanation of what was observed. */
  detail: string;
  /** Link into migration docs for failures. */
  fixUrl?: string;
  /**
   * Structured signal a check surfaces for downstream consumers (e.g. the
   * registry scan's version histogram). Human-readable text stays in `detail`;
   * anything a machine wants to aggregate goes here. Additive — checks that
   * don't emit it are unaffected.
   */
  data?: Record<string, unknown>;
}

export interface ProbeContext {
  url: string;
  timeoutMs: number;
  verbose: boolean;
  /** Extra HTTP headers sent with every probe (e.g. Authorization). Always present; default {}. */
  headers: Record<string, string>;
  /** Transport classification from preflight, set by the runner before checks run. */
  preflight?: Preflight;
  /**
   * Memoized request transport, established once per probe and shared by every
   * transport-using check (see getTransport). Undefined until first acquired.
   */
  transport?: Promise<Transport>;
}

/** Whether the server clears the required-3 spec checks. Decoupled from the letter grade. */
export type Readiness = "ready" | "not-ready" | "unknown";

/** Transport-level classification of the endpoint, decided before any check runs. */
export type Access = "open" | "auth-required" | "not-mcp" | "unreachable";

export interface Preflight {
  access: Access;
  /** Spoken protocolVersion via legacy initialize, when the server revealed one. */
  baseline?: string;
  detail: string;
}

export interface CheckDefinition {
  id: string;
  title: string;
  /** Why this matters for the 2026-07-28 release (shown in verbose mode). */
  why: string;
  fixUrl: string;
  /**
   * When true, this check still runs on an auth-walled (401/403) endpoint —
   * its probe is origin-level and works outside the auth wall (auth-metadata).
   * All other checks are skipped there.
   */
  runsWhenAuthWalled?: boolean;
  run(ctx: ProbeContext): Promise<Omit<CheckResult, "id" | "title" | "fixUrl">>;
}

export class NotImplementedError extends Error {
  constructor(public note: string) {
    super(note);
    this.name = "NotImplementedError";
  }
}

export interface Report {
  url: string;
  timestamp: string;
  toolVersion: string;
  targetSpec: "2026-07-28";
  preflight: Preflight;
  results: CheckResult[];
  /**
   * Headline verdict over the required-3 spec checks (discover, routing-headers,
   * session-independence). Decoupled from `grade` so a fully-migrated server
   * reads "ready" regardless of how the optional/warn checks land.
   */
  readiness: Readiness;
  /** Protocol facts observed during probing, for the scan's version distribution. */
  protocol?: {
    /** How a working request mode was established: "next" | "legacy-session" | "none". */
    transportMode?: TransportMode;
    /** protocolVersions server/discover advertised (modern servers only). */
    declaredVersions?: string[];
  };
  grade: string;
  summary: {
    pass: number;
    fail: number;
    warn: number;
    inconclusive: number;
    todo: number;
    error: number;
    skipped: number;
  };
}
