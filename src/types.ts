export type CheckStatus = "pass" | "fail" | "warn" | "todo" | "error" | "skipped";

export interface CheckResult {
  id: string;
  title: string;
  status: CheckStatus;
  /** One-line explanation of what was observed. */
  detail: string;
  /** Link into migration docs for failures. */
  fixUrl?: string;
}

export interface ProbeContext {
  url: string;
  timeoutMs: number;
  verbose: boolean;
  /** Extra HTTP headers sent with every probe (e.g. Authorization). Always present; default {}. */
  headers: Record<string, string>;
  /** Transport classification from preflight, set by the runner before checks run. */
  preflight?: Preflight;
}

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
  grade: string;
  summary: { pass: number; fail: number; warn: number; todo: number; error: number; skipped: number };
}
