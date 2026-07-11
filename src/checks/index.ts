import type { CheckDefinition } from "../types.js";
import { discover } from "./discover.js";
import { routingHeaders } from "./routing-headers.js";
import { sessionIndependence } from "./session-independence.js";
import { errorCodes } from "./error-codes.js";
import { cacheMetadata } from "./cache-metadata.js";
import { mrtr } from "./mrtr.js";
import { deprecatedFeatures } from "./deprecated-features.js";

export const allChecks: CheckDefinition[] = [
  discover,
  routingHeaders,
  sessionIndependence,
  errorCodes,
  cacheMetadata,
  mrtr,
  deprecatedFeatures,
];
