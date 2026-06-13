import type { UsageEvent } from '../types.js';

export const WINDOW_MS = 5 * 60 * 60 * 1000;

export const TOKEN_WEIGHTS = {
  input:           1,
  output:          4,
  cacheCreation5m: 1.25,
  cacheCreation1h: 2.0,
  cacheRead:       0.1,
} as const;

export interface WindowStats {
  windowStart: Date;
  windowEnd: Date;
  events: UsageEvent[];
  weightedTokens: number;
  ratio: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  msUntilExpiry: number;
}

export function computeWeightedTokens(e: UsageEvent): number {
  return (
    e.inputTokens          * TOKEN_WEIGHTS.input +
    e.outputTokens         * TOKEN_WEIGHTS.output +
    e.cacheCreationTokens  * TOKEN_WEIGHTS.cacheCreation5m +
    e.cacheCreation1hTokens * TOKEN_WEIGHTS.cacheCreation1h +
    e.cacheReadTokens      * TOKEN_WEIGHTS.cacheRead
  );
}

export function computeWindow(events: UsageEvent[], limit?: number | null, now = new Date()): WindowStats {
  const windowStart = new Date(now.getTime() - WINDOW_MS);
  const windowEvents = events.filter(e => e.ts >= windowStart && e.ts <= now);

  let weighted = 0;
  let input = 0;
  let output = 0;
  let cacheCreation = 0;
  let cacheRead = 0;

  for (const e of windowEvents) {
    weighted      += computeWeightedTokens(e);
    input         += e.inputTokens;
    output        += e.outputTokens;
    cacheCreation += e.cacheCreationTokens;
    cacheRead     += e.cacheReadTokens;
  }

  const oldest = windowEvents[0];
  const msUntilExpiry = oldest
    ? oldest.ts.getTime() + WINDOW_MS - now.getTime()
    : WINDOW_MS;

  return {
    windowStart,
    windowEnd: now,
    events: windowEvents,
    weightedTokens: weighted,
    ratio: limit != null ? Math.min(weighted / limit, 1) : 0,
    inputTokens: input,
    outputTokens: output,
    cacheCreationTokens: cacheCreation,
    cacheReadTokens: cacheRead,
    msUntilExpiry: Math.max(0, msUntilExpiry),
  };
}
