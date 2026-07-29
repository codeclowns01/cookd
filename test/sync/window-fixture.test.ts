/**
 * THE shared window fixture, companion side (ADR 0009, plan T19).
 *
 * The same numbers live in three places, one per implementation of the same
 * rule. Change one and the other two fail:
 *
 *   1. this file                                          (companion, producer)
 *   2. `cookd-app/app/src/lib/windowFixture.ts`           (phone, display)
 *   3. `cookd-app/supabase/test/window-fixture.test.sql`  (server, authoritative)
 *
 * The companion is the producer: it turns transcript events into buckets. What
 * it must agree on is the BUCKET GRID and the raw component split — the server
 * and the phone then apply the weights to whatever it shipped. So this file
 * pins the fold; the other two pin the weighting.
 *
 * The weights themselves are checked here too, because `computeWeightedTokens`
 * is what the growth gate uses, and a drift there would change WHEN the
 * companion pushes even if the numbers it pushes stay correct.
 */
import { describe, it, expect } from 'vitest';
import type { UsageEvent } from '../../src/adapters/types.js';
import { foldIntoBuckets, bucketsInWindow } from '../../src/sync/buckets.js';
import { computeWeightedTokens } from '../../src/adapters/claude-code/window.js';

/** Window = [07:05, 12:05]. Identical to the app and SQL fixtures. */
const FIXTURE_NOW = new Date('2026-07-28T12:05:00.000Z');

const ev = (
  iso: string,
  input: number,
  output: number,
  cache5m = 0,
  cache1h = 0,
  cacheRead = 0,
): UsageEvent => ({
  ts: new Date(iso),
  model: 'claude-opus-5',
  inputTokens: input,
  outputTokens: output,
  cacheCreationTokens: cache5m,
  cacheCreation1hTokens: cache1h,
  cacheReadTokens: cacheRead,
});

/** One event per fixture bucket, placed inside its 15-minute slot. */
const EVENTS: UsageEvent[] = [
  ev('2026-07-28T06:50:00.000Z', 10000, 10000),            // -> 06:45 slot, aged out
  ev('2026-07-28T07:05:00.000Z', 1200, 300, 400, 0, 5000), // -> 07:00 slot, straddles
  ev('2026-07-28T09:10:00.000Z', 2000, 500, 0, 100, 10000),// -> 09:00 slot, inside
  ev('2026-07-28T12:03:00.000Z', 800, 200),                // -> 12:00 slot, still filling
];

describe('shared window fixture — companion', () => {
  it('folds events onto the same 15-minute grid the server keys on', () => {
    const buckets = foldIntoBuckets(EVENTS);

    expect(buckets.map((b) => b.bucketStart)).toEqual([
      '2026-07-28T06:45:00.000Z',
      '2026-07-28T07:00:00.000Z',
      '2026-07-28T09:00:00.000Z',
      '2026-07-28T12:00:00.000Z',
    ]);

    // Raw components, never pre-weighted (journal D2) — these are the exact
    // numbers the app and SQL fixtures then apply weights to.
    expect(buckets[1]).toMatchObject({
      input: 1200, output: 300, cache5m: 400, cache1h: 0, cacheRead: 5000,
    });
    expect(buckets[2]).toMatchObject({
      input: 2000, output: 500, cache5m: 0, cache1h: 100, cacheRead: 10000,
    });
    expect(buckets[3]).toMatchObject({
      input: 800, output: 200, cache5m: 0, cache1h: 0, cacheRead: 0,
    });
  });

  it('ships the window, not the corpus — the aged-out slot is not re-sent', () => {
    // The 06:45 slot is older than the window that begins at the aligned
    // boundary below 07:05. It stays on disk and stays counted in the server's
    // history; it is simply not part of this push.
    const shipped = bucketsInWindow(EVENTS, FIXTURE_NOW);
    expect(shipped.map((b) => b.bucketStart)).toEqual([
      '2026-07-28T07:00:00.000Z',
      '2026-07-28T09:00:00.000Z',
      '2026-07-28T12:00:00.000Z',
    ]);
  });

  it('weights each fixture bucket exactly as the server does', () => {
    // 1200*1 + 300*4 + 400*1.25 + 0*2 + 5000*0.1
    expect(computeWeightedTokens(EVENTS[1])).toBe(3400);
    // 2000*1 + 500*4 + 0*1.25 + 100*2 + 10000*0.1
    expect(computeWeightedTokens(EVENTS[2])).toBe(5200);
    // 800*1 + 200*4
    expect(computeWeightedTokens(EVENTS[3])).toBe(1600);
  });

  it('reproduces the shared total once the window proration is applied', () => {
    // This is the number the other two fixtures assert: 8000 weighted tokens.
    // Reproduced here from the companion's own weights and the same overlap
    // rule, so a weight change in window.ts fails HERE first — before it
    // silently changes every user's percentage.
    const BUCKET_MS = 15 * 60 * 1000;
    const WINDOW_MS = 5 * 60 * 60 * 1000;
    const overlap = (startIso: string) => {
      const start = new Date(startIso).getTime();
      const inside =
        Math.min(start + BUCKET_MS, FIXTURE_NOW.getTime()) -
        Math.max(start, FIXTURE_NOW.getTime() - WINDOW_MS);
      return Math.max(0, Math.min(1, inside / BUCKET_MS));
    };

    const total = foldIntoBuckets(EVENTS).reduce(
      (sum, b) =>
        sum +
        (b.input * 1 + b.output * 4 + b.cache5m * 1.25 + b.cache1h * 2 + b.cacheRead * 0.1) *
          overlap(b.bucketStart),
      0,
    );

    expect(Math.round(total)).toBe(8000);
  });
});
