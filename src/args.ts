/**
 * Pure CLI argument parsing, extracted so it's unit-testable.
 *
 * Value-taking flags (--timeout, --bearer, --header) consume the next argv
 * entry — the URL scan must skip those values, otherwise `--bearer XYZ`
 * would be parsed as URL "XYZ".
 */

export interface ParsedArgs {
  url?: string;
  timeoutMs: number;
  verbose: boolean;
  json: boolean;
  help: boolean;
  version: boolean;
  /** Extra HTTP headers to send with every probe. */
  headers: Record<string, string>;
  error?: string;
}

// RFC 9110 token — what fetch's Headers will accept as a header name. Values
// must not carry CR/LF/NUL. Rejecting these here turns a malformed --header
// into a usage error instead of a bogus "access: unreachable" verdict.
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const BAD_HEADER_VALUE = /[\r\n\0]/;

export function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    timeoutMs: 15_000,
    verbose: false,
    json: false,
    help: false,
    version: false,
    headers: {},
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) continue;
    switch (arg) {
      case "--help":
        parsed.help = true;
        break;
      case "--version":
        parsed.version = true;
        break;
      case "--verbose":
        parsed.verbose = true;
        break;
      case "--json":
        parsed.json = true;
        break;
      case "--timeout": {
        const value = argv[++i];
        const ms = Number(value);
        if (value === undefined || !Number.isFinite(ms) || ms <= 0) {
          parsed.error = "--timeout expects a positive number of milliseconds";
          return parsed;
        }
        parsed.timeoutMs = ms;
        break;
      }
      case "--bearer": {
        const token = argv[++i];
        if (token === undefined || BAD_HEADER_VALUE.test(token)) {
          parsed.error = "--bearer expects a token";
          return parsed;
        }
        parsed.headers["Authorization"] = `Bearer ${token}`;
        break;
      }
      case "--header": {
        const raw = argv[++i];
        if (raw === undefined) {
          parsed.error = '--header expects "Name: value"';
          return parsed;
        }
        const colon = raw.indexOf(":");
        const name = colon > 0 ? raw.slice(0, colon).trim() : "";
        const value = colon > 0 ? raw.slice(colon + 1).trim() : "";
        if (!HEADER_NAME.test(name) || BAD_HEADER_VALUE.test(value)) {
          parsed.error = `invalid --header "${raw}" — expected "Name: value"`;
          return parsed;
        }
        parsed.headers[name] = value;
        break;
      }
      default:
        if (arg.startsWith("--")) {
          parsed.error = `unknown flag ${arg}`;
          return parsed;
        }
        if (parsed.url !== undefined) {
          parsed.error = `unexpected argument ${arg} (URL already given)`;
          return parsed;
        }
        parsed.url = arg;
    }
  }

  return parsed;
}
