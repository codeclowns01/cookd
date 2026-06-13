import { describe, it, expect } from 'vitest';
import { analyzeGaps, calibrateFromGaps, calibrate } from '../../../src/adapters/claude-code/calibrate.js';
import type { UsageEvent } from '../../../src/adapters/types.js';

const T0 = 1_700_000_000_000;

function makeEvent(tsMs: number, overrides: Partial<UsageEvent> = {}): UsageEvent {
  return {
    ts: new Date(tsMs),
    model: 'claude-sonnet-4-6',
    inputTokens: 1000,
    outputTokens: 500,
    cacheCreationTokens: 0,
    cacheCreation1hTokens: 0,
    cacheReadTokens: 0,
    ...overrides,
  };
}

function makeGap(cp: number, gapMs = 20 * 60 * 1000) {
  return { ts: new Date(T0), gapMs, cp, s4: cp * 3 };
}

describe('analyzeGaps', () => {
  it('returns no gaps for fewer than 2 events', () => {
    expect(analyzeGaps([])).toHaveLength(0);
    expect(analyzeGaps([makeEvent(T0)])).toHaveLength(0);
  });

  it('ignores gaps under 10 minutes', () => {
    const events = [makeEvent(T0), makeEvent(T0 + 5 * 60 * 1000)];
    expect(analyzeGaps(events)).toHaveLength(0);
  });

  it('ignores cold-start gaps >= 5 hours', () => {
    const events = [makeEvent(T0), makeEvent(T0 + 6 * 60 * 60 * 1000)];
    expect(analyzeGaps(events)).toHaveLength(0);
  });

  it('records gaps between 10 min and 5 hours', () => {
    const events = [makeEvent(T0), makeEvent(T0 + 30 * 60 * 1000)];
    const gaps = analyzeGaps(events);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].gapMs).toBe(30 * 60 * 1000);
  });

  it('accumulates rolling 5h window cp at gap point', () => {
    const events = [
      makeEvent(T0,        { inputTokens: 1000, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 }),
      makeEvent(T0 + 1000, { inputTokens: 2000, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 }),
      makeEvent(T0 + 30 * 60 * 1000),
    ];
    const gaps = analyzeGaps(events);
    expect(gaps).toHaveLength(1);
    // cp = (1000 * 1) + (2000 * 1) = 3000 (no output/cache tokens)
    expect(gaps[0].cp).toBe(3000);
  });

  it('evicts events outside the 5h rolling window', () => {
    const events = [
      makeEvent(T0,                          { inputTokens: 999_000, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 }),
      makeEvent(T0 + 6 * 60 * 60 * 1000,    { inputTokens: 1000,    outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 }),
      makeEvent(T0 + 6.5 * 60 * 60 * 1000), // 30 min gap
    ];
    const gaps = analyzeGaps(events);
    expect(gaps).toHaveLength(1);
    // First event is > 5h before second event, so evicted; cp = 1000 only
    expect(gaps[0].cp).toBe(1000);
  });
});

describe('calibrateFromGaps', () => {
  it('returns none confidence for empty gaps', () => {
    const result = calibrateFromGaps([]);
    expect(result.confidence).toBe('none');
    expect(result.cpLimit).toBeNull();
  });

  it('returns none for zero-cp gaps', () => {
    const result = calibrateFromGaps([makeGap(0)]);
    expect(result.confidence).toBe('none');
  });

  it('returns none for a single data point (insufficient evidence)', () => {
    const result = calibrateFromGaps([makeGap(4_500_000)]);
    expect(result.confidence).toBe('none');
    expect(result.cpLimit).toBe(null);
  });

  it('returns none for two clustered hits (insufficient evidence)', () => {
    const result = calibrateFromGaps([makeGap(4_500_000), makeGap(4_400_000)]);
    expect(result.confidence).toBe('none');
    expect(result.cpLimit).toBe(null);
  });

  it('returns high confidence for three or more clustered hits', () => {
    const gaps = [makeGap(4_500_000), makeGap(4_400_000), makeGap(4_600_000), makeGap(1_200_000)];
    const result = calibrateFromGaps(gaps);
    expect(result.confidence).toBe('high');
    expect(result.rlHits).toHaveLength(3);
    expect(result.cpLimit).toBeGreaterThan(4_300_000);
    expect(result.cpLimit).toBeLessThan(4_700_000);
  });

  it('does not cluster low-cp user-pause gaps with the RL hits', () => {
    const gaps = [
      makeGap(4_500_000), makeGap(4_400_000), makeGap(4_600_000),
      makeGap(1_000_000), makeGap(800_000), makeGap(2_000_000),
    ];
    const result = calibrateFromGaps(gaps);
    expect(result.rlHits).toHaveLength(3);
  });

});

describe('calibrate', () => {
  it('returns none for events with no qualifying gaps', () => {
    const events = Array.from({ length: 10 }, (_, i) => makeEvent(T0 + i * 1000));
    const result = calibrate(events);
    expect(result.confidence).toBe('none');
    expect(result.cpLimit).toBeNull();
  });

  it('sorts events before analysis', () => {
    // Provide events out of order — result should be same as sorted
    const e1 = makeEvent(T0 + 30 * 60 * 1000);
    const e2 = makeEvent(T0);
    const result = calibrate([e1, e2]);
    const sortedResult = calibrate([e2, e1]);
    expect(result.confidence).toBe(sortedResult.confidence);
  });
});
