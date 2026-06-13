import { describe, it, expect } from 'vitest';
import { computeWindow, computeWeightedTokens, WINDOW_MS, TOKEN_WEIGHTS } from '../../../src/adapters/claude-code/window.js';
import type { UsageEvent } from '../../../src/adapters/types.js';

function makeEvent(offsetMs: number, overrides: Partial<UsageEvent> = {}): UsageEvent {
  return {
    ts: new Date(Date.now() - offsetMs),
    model: 'claude-sonnet-4-6',
    inputTokens: 1000,
    outputTokens: 500,
    cacheCreationTokens: 0,
    cacheCreation1hTokens: 0,
    cacheReadTokens: 0,
    ...overrides,
  };
}

describe('computeWeightedTokens', () => {
  it('applies correct weights for 5m cache tier', () => {
    const e = makeEvent(0, { inputTokens: 100, outputTokens: 100, cacheCreationTokens: 100, cacheCreation1hTokens: 0, cacheReadTokens: 100 });
    const expected = 100 * TOKEN_WEIGHTS.input + 100 * TOKEN_WEIGHTS.output + 100 * TOKEN_WEIGHTS.cacheCreation5m + 100 * TOKEN_WEIGHTS.cacheRead;
    expect(computeWeightedTokens(e)).toBe(expected);
  });

  it('applies 2x weight for 1h cache tier', () => {
    const e = makeEvent(0, { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheCreation1hTokens: 100, cacheReadTokens: 0 });
    expect(computeWeightedTokens(e)).toBe(100 * TOKEN_WEIGHTS.cacheCreation1h);
  });

  it('sums 5m and 1h cache tiers independently', () => {
    const e = makeEvent(0, { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 100, cacheCreation1hTokens: 100, cacheReadTokens: 0 });
    const expected = 100 * TOKEN_WEIGHTS.cacheCreation5m + 100 * TOKEN_WEIGHTS.cacheCreation1h;
    expect(computeWeightedTokens(e)).toBe(expected);
  });
});

describe('computeWindow', () => {
  it('returns empty window for no events', () => {
    const stats = computeWindow([]);
    expect(stats.events).toHaveLength(0);
    expect(stats.weightedTokens).toBe(0);
    expect(stats.ratio).toBe(0);
  });

  it('includes events within the 5-hour window', () => {
    const events = [
      makeEvent(4 * 60 * 60 * 1000),  // 4h ago — inside
      makeEvent(6 * 60 * 60 * 1000),  // 6h ago — outside
    ];
    const stats = computeWindow(events);
    expect(stats.events).toHaveLength(1);
  });

  it('sums token counts correctly', () => {
    const events = [
      makeEvent(1000, { inputTokens: 500, outputTokens: 200, cacheCreationTokens: 0, cacheReadTokens: 0 }),
      makeEvent(2000, { inputTokens: 300, outputTokens: 100, cacheCreationTokens: 0, cacheReadTokens: 0 }),
    ];
    const stats = computeWindow(events);
    expect(stats.inputTokens).toBe(800);
    expect(stats.outputTokens).toBe(300);
  });

  it('caps ratio at 1 when limit is provided', () => {
    const events = Array.from({ length: 1000 }, (_, i) =>
      makeEvent(i * 1000, { inputTokens: 100_000, outputTokens: 50_000, cacheCreationTokens: 0, cacheReadTokens: 0 }),
    );
    const stats = computeWindow(events, 1);
    expect(stats.ratio).toBeLessThanOrEqual(1);
  });

  it('returns zero ratio when no limit provided', () => {
    const events = [makeEvent(0, { inputTokens: 100_000, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 })];
    const stats = computeWindow(events);
    expect(stats.ratio).toBe(0);
  });
});
