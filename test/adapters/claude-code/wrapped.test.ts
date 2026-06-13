import { describe, it, expect } from 'vitest';
import { computeModelBreakdown, computeDailyStats, computeLifetimeStats } from '../../../src/adapters/claude-code/wrapped.js';
import type { UsageEvent } from '../../../src/adapters/types.js';

function makeEvent(overrides: Partial<UsageEvent> = {}): UsageEvent {
  return {
    ts: new Date('2026-06-13T10:00:00.000Z'),
    model: 'claude-sonnet-4-6',
    inputTokens: 1000,
    outputTokens: 500,
    cacheCreationTokens: 0,
    cacheCreation1hTokens: 0,
    cacheReadTokens: 0,
    ...overrides,
  };
}

describe('computeModelBreakdown', () => {
  it('returns empty array for empty events', () => {
    expect(computeModelBreakdown([])).toEqual([]);
  });

  it('returns 100% for single model', () => {
    const events = [makeEvent({ inputTokens: 1000, outputTokens: 0 })];
    const result = computeModelBreakdown(events);
    expect(result).toHaveLength(1);
    expect(result[0].model).toBe('claude-sonnet-4-6');
    expect(result[0].pctOfWindow).toBe(100);
  });

  it('orders models by CP descending', () => {
    const events = [
      makeEvent({ model: 'claude-sonnet-4-6', inputTokens: 100, outputTokens: 0 }),
      makeEvent({ model: 'claude-opus-4-8', inputTokens: 1000, outputTokens: 0 }),
    ];
    const result = computeModelBreakdown(events);
    expect(result[0].model).toBe('claude-opus-4-8');
    expect(result[1].model).toBe('claude-sonnet-4-6');
  });

  it('excludes error events (limitResetAt set) from breakdown', () => {
    const events = [
      makeEvent({ inputTokens: 1000, outputTokens: 0 }),
      makeEvent({ inputTokens: 0, outputTokens: 0, limitResetAt: new Date() }),
    ];
    const result = computeModelBreakdown(events);
    expect(result).toHaveLength(1);
  });
});

describe('computeDailyStats', () => {
  const TODAY = '2026-06-13';

  it('returns zero stats for no events on that day', () => {
    const stats = computeDailyStats([], TODAY);
    expect(stats.totalCp).toBe(0);
    expect(stats.sessionCount).toBe(0);
    expect(stats.limitHitCount).toBe(0);
    expect(stats.firstSessionAt).toBeNull();
    expect(stats.lastActivityAt).toBeNull();
  });

  it('filters out events not on the specified local date', () => {
    const wrongDay = makeEvent({ ts: new Date('2026-06-12T10:00:00.000Z') });
    const stats = computeDailyStats([wrongDay], TODAY);
    expect(stats.totalCp).toBe(0);
  });

  it('counts distinct sessionIds for session count', () => {
    const events = [
      makeEvent({ sessionId: 'sess_a', ts: new Date('2026-06-13T08:00:00') }),
      makeEvent({ sessionId: 'sess_a', ts: new Date('2026-06-13T08:30:00') }),
      makeEvent({ sessionId: 'sess_b', ts: new Date('2026-06-13T14:00:00') }),
    ];
    const stats = computeDailyStats(events, TODAY);
    expect(stats.sessionCount).toBe(2);
  });

  it('counts limitHitCount from error entries on that day', () => {
    const events = [
      makeEvent({ ts: new Date('2026-06-13T10:00:00') }),
      makeEvent({ ts: new Date('2026-06-13T10:05:00'), inputTokens: 0, outputTokens: 0, limitResetAt: new Date() }),
    ];
    const stats = computeDailyStats(events, TODAY);
    expect(stats.limitHitCount).toBe(1);
    expect(stats.totalCp).toBeGreaterThan(0);
  });

  it('sets firstSessionAt and lastActivityAt correctly', () => {
    const early = new Date('2026-06-13T08:00:00');
    const late = new Date('2026-06-13T20:00:00');
    const events = [
      makeEvent({ ts: late }),
      makeEvent({ ts: early }),
    ];
    const stats = computeDailyStats(events, TODAY);
    expect(new Date(stats.firstSessionAt!).getTime()).toBe(early.getTime());
    expect(new Date(stats.lastActivityAt!).getTime()).toBe(late.getTime());
  });
});

describe('computeLifetimeStats', () => {
  it('returns zero defaults for empty events', () => {
    const stats = computeLifetimeStats([]);
    expect(stats.totalTokens).toBe(0);
    expect(stats.prompts).toBe(0);
    expect(stats.topModel).toBe('unknown');
    expect(stats.topProject).toBe('unknown');
    expect(stats.agentHeavyPct).toBe(0);
  });

  it('counts only non-error events in prompts', () => {
    const events = [
      makeEvent(),
      makeEvent({ inputTokens: 0, outputTokens: 0, limitResetAt: new Date() }),
    ];
    const stats = computeLifetimeStats(events);
    expect(stats.prompts).toBe(1);
  });

  it('identifies topModel by CP not event count', () => {
    const events = [
      makeEvent({ model: 'claude-sonnet-4-6', inputTokens: 100, outputTokens: 0 }),
      makeEvent({ model: 'claude-sonnet-4-6', inputTokens: 100, outputTokens: 0 }),
      makeEvent({ model: 'claude-opus-4-8', inputTokens: 10000, outputTokens: 0 }),
    ];
    const stats = computeLifetimeStats(events);
    expect(stats.topModel).toBe('claude-opus-4-8');
  });

  it('computes agentHeavyPct from sidechain events', () => {
    const events = [
      makeEvent({ inputTokens: 1000, outputTokens: 0, isSidechain: false }),
      makeEvent({ inputTokens: 1000, outputTokens: 0, isSidechain: true }),
    ];
    const stats = computeLifetimeStats(events);
    expect(stats.agentHeavyPct).toBe(50);
  });

  it('computes maxContext as max raw token sum per event', () => {
    const events = [
      makeEvent({ inputTokens: 100, outputTokens: 50, cacheCreationTokens: 0, cacheReadTokens: 0 }),
      makeEvent({ inputTokens: 500, outputTokens: 200, cacheCreationTokens: 100, cacheReadTokens: 50 }),
    ];
    const stats = computeLifetimeStats(events);
    expect(stats.maxContext).toBe(850);
  });

  it('topProject uses projectName with highest CP', () => {
    const events = [
      makeEvent({ projectName: 'small-proj', inputTokens: 100, outputTokens: 0 }),
      makeEvent({ projectName: 'big-proj', inputTokens: 10000, outputTokens: 0 }),
    ];
    const stats = computeLifetimeStats(events);
    expect(stats.topProject).toBe('big-proj');
  });
});
