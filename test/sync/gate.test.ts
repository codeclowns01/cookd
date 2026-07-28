import { describe, it, expect } from 'vitest';
import {
  shouldPush, signaturesEqual, recordScanMs, p95ScanMs,
  GROWTH_THRESHOLD, type ScanSignature, type SyncState,
} from '../../src/sync/gate.js';

const sig = (o: Partial<ScanSignature> = {}): ScanSignature =>
  ({ fileCount: 3, totalSize: 1000, maxMtimeMs: 5_000, ...o });

describe('signaturesEqual — the stat-only scan gate', () => {
  it('equal when every field matches', () => {
    expect(signaturesEqual(sig(), sig())).toBe(true);
  });

  it('differs when a file is added', () => {
    expect(signaturesEqual(sig(), sig({ fileCount: 4 }))).toBe(false);
  });

  it('differs when a transcript grows', () => {
    expect(signaturesEqual(sig(), sig({ totalSize: 1001 }))).toBe(false);
  });

  it('differs when a transcript is touched', () => {
    expect(signaturesEqual(sig(), sig({ maxMtimeMs: 5_001 }))).toBe(false);
  });

  it('is false when either side is missing, so a first run always scans', () => {
    expect(signaturesEqual(undefined, sig())).toBe(false);
    expect(signaturesEqual(sig(), undefined)).toBe(false);
  });
});

describe('shouldPush — growth gate (journal D4)', () => {
  const limit = 1_000_000;
  const threshold = limit * GROWTH_THRESHOLD; // 50,000

  it('pushes on the very first sync, with nothing to compare against', () => {
    expect(shouldPush(1234, limit, undefined)).toBe(true);
  });

  it('does not push when the window has not moved at all', () => {
    expect(shouldPush(500_000, limit, 500_000)).toBe(false);
  });

  it('does not push below the 5% threshold', () => {
    expect(shouldPush(500_000 + threshold - 1, limit, 500_000)).toBe(false);
  });

  it('pushes exactly at the threshold', () => {
    expect(shouldPush(500_000 + threshold, limit, 500_000)).toBe(true);
  });

  it('pushes on a large jump', () => {
    expect(shouldPush(900_000, limit, 100_000)).toBe(true);
  });

  it('pushes when the window SHRINKS past the threshold', () => {
    // The window is rolling — usage ageing out is real information, and
    // withholding it would leave the server over-reporting the user.
    expect(shouldPush(500_000, limit, 500_000 + threshold)).toBe(true);
  });

  it('pushes on any change when there is no calibrated limit', () => {
    // No limit means no meaningful denominator. Being wrong about the limit must
    // not degrade into never reporting usage at all.
    expect(shouldPush(10, null, 9)).toBe(true);
    expect(shouldPush(10, 0, 9)).toBe(true);
  });

  it('still does not push a zero delta with no limit', () => {
    expect(shouldPush(10, null, 10)).toBe(false);
  });
});

describe('scan wall-time instrumentation', () => {
  it('records samples in order', () => {
    let s: SyncState = {};
    s = recordScanMs(s, 100);
    s = recordScanMs(s, 200);
    expect(s.scanMs).toEqual([100, 200]);
  });

  it('rounds fractional durations', () => {
    expect(recordScanMs({}, 12.7).scanMs).toEqual([13]);
  });

  it('keeps only the most recent 50 samples', () => {
    let s: SyncState = {};
    for (let i = 1; i <= 60; i += 1) s = recordScanMs(s, i);
    expect(s.scanMs).toHaveLength(50);
    expect(s.scanMs![0]).toBe(11);
    expect(s.scanMs![49]).toBe(60);
  });

  it('reports no p95 until there are enough samples', () => {
    expect(p95ScanMs({ scanMs: [1, 2, 3, 4] })).toBeNull();
  });

  it('ignores a lone outlier — one slow scan in 20 is not the p95', () => {
    const oneOutlier = Array.from({ length: 20 }, (_, i) => (i === 19 ? 9000 : 100));
    expect(p95ScanMs({ scanMs: oneOutlier })).toBe(100);
  });

  it('reports a p95 the ADR trigger can fire on when scans are genuinely slow', () => {
    // ADR 0009: revisit the incremental-cursor decision at p95 > 5s. Two slow
    // scans in 20 puts the 95th percentile above the line.
    const trulySlow = Array.from({ length: 20 }, (_, i) => (i >= 18 ? 9000 : 100));
    expect(p95ScanMs({ scanMs: trulySlow })).toBeGreaterThan(5000);
  });
});
