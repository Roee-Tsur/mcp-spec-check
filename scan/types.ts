/**
 * Types shared across the scan pipeline. The per-URL Envelope is the unit of
 * resumable work: one file under reports/, holding the full Report plus how the
 * probe terminated. aggregate.ts reads a directory of these and never touches
 * the network.
 */
import type { Report } from "../src/types.js";

/** How a single target's probe ended. */
export type ProbeOutcome =
  | "ok" // probeServer returned a Report (which itself may say unreachable/not-mcp/etc.)
  | "budget-exceeded" // the 120s per-target wall-clock budget fired first
  | "crash"; // probeServer threw (a probe bug — should be rare)

export interface Envelope {
  url: string;
  hash: string;
  outcome: ProbeOutcome;
  startedAt: string;
  finishedAt: string;
  /** How many times this target was probed (1 + retry-pass attempts). */
  attempts: number;
  /** Present when outcome === "ok". */
  report?: Report;
  /** Present when outcome !== "ok". */
  error?: string;
}
