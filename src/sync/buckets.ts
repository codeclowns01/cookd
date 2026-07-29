import type { UsageEvent } from '../adapters/types.js';
import { WINDOW_MS } from '../adapters/claude-code/window.js';

/** 15 minutes (ADR 0009 / journal D10). Twenty buckets cover the 5-hour rolling
 *  window, and the resulting error sits below display resolution. */
export const BUCKET_MS = 15 * 60 * 1000;

/**
 * One 15-minute slot of usage from one device.
 *
 * Raw token components only, never pre-weighted (journal D2). The weights in
 * `window.ts` are an undocumented guess; storing components means re-tuning them
 * later is a config change that corrects all history retroactively, rather than
 * a migration that cannot recover what was thrown away.
 */
export interface UsageBucket {
  /** 15-minute-aligned UTC instant, ISO-8601. */
  bucketStart: string;
  input: number;
  output: number;
  cache5m: number;
  cache1h: number;
  cacheRead: number;
  /** model id -> raw token count attributed to it in this slot. */
  models: Record<string, number>;
  eventCount: number;
  /** Distinct subagent sessions that wrote into this slot. */
  agentRuns: number;
  /** Raw tokens attributable to subagent runs within this slot. */
  agentTokens: number;
}

/** Floor an instant to its 15-minute UTC boundary. */
export function alignToBucket(d: Date): Date {
  return new Date(Math.floor(d.getTime() / BUCKET_MS) * BUCKET_MS);
}

function rawTokens(e: UsageEvent): number {
  return (
    e.inputTokens +
    e.outputTokens +
    e.cacheCreationTokens +
    e.cacheCreation1hTokens +
    e.cacheReadTokens
  );
}

/**
 * Fold events into 15-minute buckets.
 *
 * **Events MUST already be de-duplicated by `message.id`.** Dedup happens before
 * bucketing and may never be removed (journal D11): it was measured to prevent a
 * 347M weighted-token over-count per sync. Once events are folded, `message.id`
 * is gone and the duplication is unrecoverable — which is also why cross-device
 * de-duplication is impossible by construction under the multi-device SUM
 * decision.
 *
 * Returns buckets sorted by `bucketStart` ascending.
 */
export function foldIntoBuckets(dedupedEvents: UsageEvent[]): UsageBucket[] {
  const acc = new Map<number, UsageBucket & { _agentSessions: Set<string> }>();

  for (const e of dedupedEvents) {
    const key = alignToBucket(e.ts).getTime();
    let b = acc.get(key);
    if (!b) {
      b = {
        bucketStart: new Date(key).toISOString(),
        input: 0, output: 0, cache5m: 0, cache1h: 0, cacheRead: 0,
        models: {}, eventCount: 0, agentRuns: 0, agentTokens: 0,
        _agentSessions: new Set<string>(),
      };
      acc.set(key, b);
    }

    b.input += e.inputTokens;
    b.output += e.outputTokens;
    b.cache5m += e.cacheCreationTokens;
    b.cache1h += e.cacheCreation1hTokens;
    b.cacheRead += e.cacheReadTokens;
    b.eventCount += 1;

    const model = e.model || 'unknown';
    b.models[model] = (b.models[model] ?? 0) + rawTokens(e);

    if (e.isSidechain) {
      b.agentTokens += rawTokens(e);
      if (e.sessionId) b._agentSessions.add(e.sessionId);
    }
  }

  return [...acc.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, b]) => {
      const { _agentSessions, ...rest } = b;
      return { ...rest, agentRuns: _agentSessions.size };
    });
}

/**
 * The buckets covering the current 5-hour rolling window.
 *
 * Every push re-ships this whole window (journal D6), at most 20 buckets and
 * roughly 3 KB. Re-shipping removes any need to reason about how long a
 * background agent runs: an agent that finishes 77 minutes after its parent turn
 * writes into an already-pushed slot, and the next push simply carries the
 * revised absolute total. Combined with the server's `greatest()` merge, replay
 * and reordering are safe by construction.
 */
export function bucketsInWindow(dedupedEvents: UsageEvent[], now = new Date()): UsageBucket[] {
  const windowStart = alignToBucket(new Date(now.getTime() - WINDOW_MS)).getTime();
  return foldIntoBuckets(
    dedupedEvents.filter(e => e.ts.getTime() >= windowStart && e.ts.getTime() <= now.getTime()),
  );
}
