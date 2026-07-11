export type CheckStatus = "pass" | "fail" | "warn" | "todo" | "error";

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
}

export interface CheckDefinition {
  id: string;
  title: string;
  /** Why this matters for the 2026-07-28 release (shown in verbose mode). */
  why: string;
  fixUrl: string;
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
  results: CheckResult[];
  grade: string;
  summary: { pass: number; fail: number; warn: number; todo: number; error: number };
}
