import { computeWeightedTokens, WINDOW_MS } from './window.js';
import type { UsageEvent } from '../types.js';

const MIN_GAP_MS = 10 * 60 * 1000;

export interface GapRecord {
  ts: Date;
  gapMs: number;
  cp: number;
  s4: number;
}

export type CalibrationConfidence = 'none' | 'low' | 'medium' | 'high';

export interface CalibrationResult {
  cpLimit: number | null;
  confidence: CalibrationConfidence;
  rlHits: GapRecord[];
}

function sumS4(e: UsageEvent): number {
  return e.inputTokens + e.outputTokens + e.cacheCreationTokens + e.cacheReadTokens;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

export function analyzeGaps(events: UsageEvent[]): GapRecord[] {
  if (events.length < 2) return [];

  const gaps: GapRecord[] = [];
  let left = 0;
  let windowCp = computeWeightedTokens(events[0]);
  let windowS4 = sumS4(events[0]);

  for (let i = 1; i < events.length; i++) {
    const prev = events[i - 1];
    const curr = events[i];

    // Evict events outside the 5h window looking back from prev.ts
    const cutoff = prev.ts.getTime() - WINDOW_MS;
    while (left < i && events[left].ts.getTime() < cutoff) {
      windowCp -= computeWeightedTokens(events[left]);
      windowS4 -= sumS4(events[left]);
      left++;
    }

    const gapMs = curr.ts.getTime() - prev.ts.getTime();

    // Include gaps 10min–5h; cold starts (>= 5h) are excluded
    if (gapMs >= MIN_GAP_MS && gapMs < WINDOW_MS) {
      gaps.push({
        ts: prev.ts,
        gapMs,
        cp: Math.max(0, windowCp),
        s4: Math.max(0, windowS4),
      });
    }

    windowCp += computeWeightedTokens(curr);
    windowS4 += sumS4(curr);
  }

  return gaps;
}

export function calibrateFromGaps(gaps: GapRecord[]): CalibrationResult {
  if (gaps.length === 0) {
    return { cpLimit: null, confidence: 'none', rlHits: [] };
  }

  const sorted = [...gaps].sort((a, b) => b.cp - a.cp);
  const topCp = sorted[0].cp;

  if (topCp === 0) {
    return { cpLimit: null, confidence: 'none', rlHits: [] };
  }

  // Gaps within 25% of the maximum form the RL hit cluster
  const clusterFloor = topCp * 0.75;
  const cluster = sorted.filter(g => g.cp >= clusterFloor);

  // Require 3+ tightly-clustered gap observations before trusting gap calibration.
  // A single gap or two gaps can easily be lunch breaks or natural pauses — not
  // rate-limit hits. Without sufficient evidence, report null rather than a
  // dangerously low number.
  if (cluster.length >= 3) {
    const cpLimit = median(cluster.map(g => g.cp));
    return { cpLimit, confidence: 'high', rlHits: cluster };
  }

  return { cpLimit: null, confidence: 'none', rlHits: [] };
}

/** Calibrate using confirmed rate-limit events (isApiErrorMessage entries).
 *  Each event with limitResetAt tells us the user hit the wall at that moment.
 *  We sum CP in the 5h window just before each hit — that's the ground truth. */
export function calibrateFromRateLimitEvents(events: UsageEvent[]): CalibrationResult {
  const rlEvents = events.filter(e => e.limitResetAt != null);
  if (rlEvents.length === 0) return { cpLimit: null, confidence: 'none', rlHits: [] };

  const observations: number[] = [];
  for (const rlEvent of rlEvents) {
    const windowStart = rlEvent.ts.getTime() - WINDOW_MS;
    const cp = events
      .filter(e => !e.limitResetAt && e.ts.getTime() >= windowStart && e.ts.getTime() <= rlEvent.ts.getTime())
      .reduce((sum, e) => sum + computeWeightedTokens(e), 0);
    if (cp > 0) observations.push(cp);
  }

  if (observations.length === 0) return { cpLimit: null, confidence: 'none', rlHits: [] };

  const cpLimit = median(observations);
  const confidence = observations.length >= 3 ? 'high' : observations.length === 2 ? 'medium' : 'low';
  return { cpLimit, confidence, rlHits: [] };
}

export function calibrate(events: UsageEvent[]): CalibrationResult {
  const sorted = [...events].sort((a, b) => a.ts.getTime() - b.ts.getTime());

  // Rate-limit events are ground truth — use them first
  const rlResult = calibrateFromRateLimitEvents(sorted);
  if (rlResult.cpLimit !== null) return rlResult;

  // Gap analysis fallback — only trusted with 3+ clustered observations
  const gaps = analyzeGaps(sorted);
  return calibrateFromGaps(gaps);
}

export function extractLatestResetTime(events: UsageEvent[], windowMs = WINDOW_MS): Date | null {
  const cutoff = Date.now() - windowMs;
  return events
    .filter(e => e.limitResetAt && e.ts.getTime() >= cutoff)
    .sort((a, b) => b.ts.getTime() - a.ts.getTime())[0]
    ?.limitResetAt ?? null;
}
