import { describe, it, expect } from 'vitest';
import { alignToBucket, foldIntoBuckets, bucketsInWindow, BUCKET_MS } from '../../src/sync/buckets.js';
import { deduplicateEvents } from '../../src/adapters/claude-code/transcript.js';
import type { UsageEvent } from '../../src/adapters/types.js';

function ev(partial: Partial<UsageEvent> & { ts: Date }): UsageEvent {
  return {
    model: 'claude-sonnet-5',
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheCreation1hTokens: 0,
    cacheReadTokens: 0,
    isSidechain: false,
    ...partial,
  };
}

describe('alignToBucket', () => {
  it('floors to the 15-minute boundary', () => {
    expect(alignToBucket(new Date('2026-07-28T10:07:33.412Z')).toISOString())
      .toBe('2026-07-28T10:00:00.000Z');
    expect(alignToBucket(new Date('2026-07-28T10:44:59.999Z')).toISOString())
      .toBe('2026-07-28T10:30:00.000Z');
  });

  it('is idempotent on an already-aligned instant', () => {
    const aligned = new Date('2026-07-28T10:45:00.000Z');
    expect(alignToBucket(aligned).getTime()).toBe(aligned.getTime());
  });
});

describe('foldIntoBuckets', () => {
  it('groups events into 15-minute slots and sums raw components', () => {
    const buckets = foldIntoBuckets([
      ev({ ts: new Date('2026-07-28T10:01:00Z'), inputTokens: 100, outputTokens: 10 }),
      ev({ ts: new Date('2026-07-28T10:14:00Z'), inputTokens: 50, cacheReadTokens: 7 }),
      ev({ ts: new Date('2026-07-28T10:16:00Z'), outputTokens: 5, cacheCreationTokens: 3 }),
    ]);

    expect(buckets).toHaveLength(2);
    expect(buckets[0].bucketStart).toBe('2026-07-28T10:00:00.000Z');
    expect(buckets[0].input).toBe(150);
    expect(buckets[0].output).toBe(10);
    expect(buckets[0].cacheRead).toBe(7);
    expect(buckets[0].eventCount).toBe(2);
    expect(buckets[1].bucketStart).toBe('2026-07-28T10:15:00.000Z');
    expect(buckets[1].output).toBe(5);
    expect(buckets[1].cache5m).toBe(3);
  });

  it('returns buckets sorted ascending regardless of input order', () => {
    const buckets = foldIntoBuckets([
      ev({ ts: new Date('2026-07-28T11:00:00Z'), inputTokens: 1 }),
      ev({ ts: new Date('2026-07-28T09:00:00Z'), inputTokens: 1 }),
      ev({ ts: new Date('2026-07-28T10:00:00Z'), inputTokens: 1 }),
    ]);
    expect(buckets.map(b => b.bucketStart)).toEqual([
      '2026-07-28T09:00:00.000Z',
      '2026-07-28T10:00:00.000Z',
      '2026-07-28T11:00:00.000Z',
    ]);
  });

  it('stores raw components, never pre-weighted totals (D2)', () => {
    // output is weighted 4x in window.ts. The bucket must NOT apply that.
    const [b] = foldIntoBuckets([ev({ ts: new Date('2026-07-28T10:00:00Z'), outputTokens: 25 })]);
    expect(b.output).toBe(25);
  });

  it('counts distinct subagent sessions as agentRuns', () => {
    const t = new Date('2026-07-28T10:00:00Z');
    const [b] = foldIntoBuckets([
      ev({ ts: t, inputTokens: 10, isSidechain: true, sessionId: 'agent-a' }),
      ev({ ts: t, inputTokens: 10, isSidechain: true, sessionId: 'agent-a' }),
      ev({ ts: t, inputTokens: 10, isSidechain: true, sessionId: 'agent-b' }),
      ev({ ts: t, inputTokens: 10, isSidechain: false, sessionId: 'main' }),
    ]);
    expect(b.agentRuns).toBe(2);
    expect(b.agentTokens).toBe(30);
    expect(b.eventCount).toBe(4);
  });

  it('attributes raw tokens per model', () => {
    const t = new Date('2026-07-28T10:00:00Z');
    const [b] = foldIntoBuckets([
      ev({ ts: t, model: 'claude-opus-5', inputTokens: 10, outputTokens: 5 }),
      ev({ ts: t, model: 'claude-haiku-4-5', inputTokens: 2 }),
    ]);
    expect(b.models).toEqual({ 'claude-opus-5': 15, 'claude-haiku-4-5': 2 });
  });

  it('returns an empty list for no events', () => {
    expect(foldIntoBuckets([])).toEqual([]);
  });
});

describe('dedup must run BEFORE bucketing (journal D11)', () => {
  // Measured on real transcripts: skipping dedup over-counts by 347M weighted
  // tokens per sync. Bucketing discards message.id, so a duplicate folded into a
  // bucket can never be recovered afterwards.
  const t = new Date('2026-07-28T10:00:00Z');
  const dupes: UsageEvent[] = [
    ev({ ts: t, inputTokens: 100, messageId: 'msg_1' }),
    ev({ ts: t, inputTokens: 100, messageId: 'msg_1' }),
    ev({ ts: t, inputTokens: 100, messageId: 'msg_1' }),
  ];

  it('over-counts when dedup is skipped', () => {
    const [b] = foldIntoBuckets(dupes);
    expect(b.input).toBe(300);
    expect(b.eventCount).toBe(3);
  });

  it('counts each message exactly once when dedup runs first', () => {
    const [b] = foldIntoBuckets(deduplicateEvents(dupes));
    expect(b.input).toBe(100);
    expect(b.eventCount).toBe(1);
  });
});

describe('bucketsInWindow', () => {
  const now = new Date('2026-07-28T12:00:00Z');

  it('excludes events older than the 5-hour window', () => {
    const buckets = bucketsInWindow([
      ev({ ts: new Date('2026-07-28T06:00:00Z'), inputTokens: 999 }), // 6h ago
      ev({ ts: new Date('2026-07-28T11:00:00Z'), inputTokens: 10 }),
    ], now);
    expect(buckets).toHaveLength(1);
    expect(buckets[0].input).toBe(10);
  });

  it('excludes events in the future', () => {
    const buckets = bucketsInWindow([
      ev({ ts: new Date('2026-07-28T13:00:00Z'), inputTokens: 5 }),
    ], now);
    expect(buckets).toEqual([]);
  });

  it('never exceeds 21 buckets for a fully-saturated window', () => {
    // 5h / 15min = 20 slots, +1 for the partially-covered edge bucket.
    const events: UsageEvent[] = [];
    for (let i = 0; i < 5 * 60; i += 1) {
      events.push(ev({ ts: new Date(now.getTime() - i * 60_000), inputTokens: 1 }));
    }
    const buckets = bucketsInWindow(events, now);
    expect(buckets.length).toBeLessThanOrEqual(21);
    expect(buckets.length).toBeGreaterThan(15);
  });

  it('aligns the window edge to a bucket boundary', () => {
    const buckets = bucketsInWindow([
      ev({ ts: new Date(now.getTime() - 5 * 60 * 60 * 1000 + 1000), inputTokens: 1 }),
    ], now);
    expect(buckets).toHaveLength(1);
    expect(new Date(buckets[0].bucketStart).getTime() % BUCKET_MS).toBe(0);
  });
});
