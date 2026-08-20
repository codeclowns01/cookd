import { rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const TEST_COOKD_DIR = join(tmpdir(), `cookd-run-test-${process.pid}`);

// syncWindowState reports a PushOutcome as of ADR 0009's diagnosis signals —
// runSyncOnce uses it to decide whether the growth-gate markers may advance and
// what to tell the server about the last failure. Default the mock to a
// successful push; the failure paths set their own value.
vi.mock('../../src/sync/client.js', () => ({ syncWindowState: vi.fn(async () => 'ok') }));
vi.mock('../../src/adapters/registry.js', () => ({ detectAdapter: vi.fn() }));
// COOKD_DIR is required by sync/gate.ts (the stat-only scan signature and
// growth-gate state live next to the queue DB). Point it at a temp dir so the
// test never touches a real ~/.cookd.
vi.mock('../../src/auth/credentials.js', () => ({
  saveCredentials: vi.fn(),
  COOKD_DIR: join(tmpdir(), `cookd-run-test-${process.pid}`),
}));

vi.mock('../../src/adapters/claude-code/calibration-store.js', () => ({
  loadCalibration: () => ({ cpLimit: 1000, confidence: 'high', calibratedAt: 'now' }),
  saveCalibration: vi.fn(),
  isStale: () => false,
}));

import { runSyncOnce } from '../../src/sync/run.js';
import { syncWindowState } from '../../src/sync/client.js';
import { loadSyncState } from '../../src/sync/gate.js';
import { detectAdapter } from '../../src/adapters/registry.js';
import { COOKD_VERSION } from '../../src/version.js';
import type { Credentials } from '../../src/auth/credentials.js';

const creds: Credentials = { deviceToken: 't', handle: 'you', deviceId: 'd', linkedAt: 'now' };

describe('runSyncOnce', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (syncWindowState as any).mockResolvedValue('ok');
    // The stat-only gate short-circuits when the transcript signature is
    // unchanged since the last push (TG1: an idle machine costs nothing). That
    // is correct behaviour and exactly what makes these tests order-dependent,
    // so each starts from no recorded state.
    rmSync(join(TEST_COOKD_DIR, 'sync-state.json'), { force: true });
  });

  it('builds a window summary from adapter events and sends it once', async () => {
    (detectAdapter as any).mockResolvedValue({
      events: async () => ([{
        ts: new Date(), model: 'claude-sonnet-4-6',
        inputTokens: 10, outputTokens: 5,
        cacheCreationTokens: 0, cacheCreation1hTokens: 0, cacheReadTokens: 0,
      }]),
      getSessionStats: () => ({ prompts: 1, yoloPrompts: 0, toolCounts: {}, toolErrors: 0 }),
    });
    const result = await runSyncOnce(creds);
    expect(syncWindowState).toHaveBeenCalledTimes(1);
    expect(result.outcome).toBe('ok');
  });

  it('reports no_adapter when no agent is detected', async () => {
    (detectAdapter as any).mockResolvedValue(null);
    const result = await runSyncOnce(creds);
    expect(syncWindowState).not.toHaveBeenCalled();
    expect(result.outcome).toBe('no_adapter');
  });

  it('reports its own version and hook state so the app can diagnose (design DD2)', async () => {
    (detectAdapter as any).mockResolvedValue({
      events: async () => ([{
        ts: new Date(), model: 'claude-sonnet-4-6',
        inputTokens: 10, outputTokens: 5,
        cacheCreationTokens: 0, cacheCreation1hTokens: 0, cacheReadTokens: 0,
      }]),
      getSessionStats: () => ({ prompts: 1, yoloPrompts: 0, toolCounts: {}, toolErrors: 0 }),
    });
    await runSyncOnce(creds);
    const summary = (syncWindowState as any).mock.calls[0][1];
    expect(summary.companionVersion).toBe(COOKD_VERSION);
    expect(typeof summary.hooksInstalled).toBe('boolean');
    // Nothing has failed yet, so there is nothing to confess.
    expect(summary.lastError).toBeNull();
  });

  /**
   * ADR-012 / eng-review delta E1. The four early returns and the push result used
   * to collapse into one boolean, so `init` printed "synced." after making zero
   * network calls. Each cause now names itself.
   */
  it('distinguishes unchanged from ok, and force bypasses the gate (E1)', async () => {
    const adapter = {
      events: async () => ([{
        ts: new Date(), model: 'claude-sonnet-4-6',
        inputTokens: 10, outputTokens: 5,
        cacheCreationTokens: 0, cacheCreation1hTokens: 0, cacheReadTokens: 0,
      }]),
      getSessionStats: () => ({ prompts: 1, yoloPrompts: 0, toolCounts: {}, toolErrors: 0 }),
    };
    (detectAdapter as any).mockResolvedValue(adapter);

    // First push records the signature + watermark.
    expect((await runSyncOnce(creds)).outcome).toBe('ok');

    // Nothing changed on disk -> gate 1 short-circuits before any HTTP.
    (syncWindowState as any).mockClear();
    expect((await runSyncOnce(creds)).outcome).toBe('unchanged');
    expect(syncWindowState).not.toHaveBeenCalled();

    // ...but `init` must PROVE the token is alive, so force skips both gates.
    // Without this the revoked-token warning could never fire for the hook-installed
    // population, which is now the default one.
    (syncWindowState as any).mockClear();
    expect((await runSyncOnce(creds, { force: true })).outcome).toBe('ok');
    expect(syncWindowState).toHaveBeenCalledTimes(1);
  });

  it('surfaces token_rejected instead of swallowing it', async () => {
    (detectAdapter as any).mockResolvedValue({
      events: async () => ([{
        ts: new Date(), model: 'claude-sonnet-4-6',
        inputTokens: 10, outputTokens: 5,
        cacheCreationTokens: 0, cacheCreation1hTokens: 0, cacheReadTokens: 0,
      }]),
      getSessionStats: () => ({ prompts: 1, yoloPrompts: 0, toolCounts: {}, toolErrors: 0 }),
    });
    (syncWindowState as any).mockResolvedValue('token_rejected');
    const result = await runSyncOnce(creds);
    expect(result.outcome).toBe('token_rejected');
  });

  it('does not advance the growth gate when the push failed', async () => {
    // The gate compares against the last total THE SERVER ACCEPTED. Advancing it
    // on a failed push would make the companion believe the server is current,
    // and the queued payload would then wait for another full 5% of growth
    // before anything tried again.
    (detectAdapter as any).mockResolvedValue({
      events: async () => ([{
        ts: new Date(), model: 'claude-sonnet-4-6',
        inputTokens: 10, outputTokens: 5,
        cacheCreationTokens: 0, cacheCreation1hTokens: 0, cacheReadTokens: 0,
      }]),
      getSessionStats: () => ({ prompts: 1, yoloPrompts: 0, toolCounts: {}, toolErrors: 0 }),
    });
    (syncWindowState as any).mockResolvedValue('network');

    const result = await runSyncOnce(creds);
    expect(result.outcome).toBe('network');

    const state = loadSyncState();
    expect(state.lastPushedWeighted).toBeUndefined();
    // ...and the failure is held so the next successful push can report it.
    expect(state.lastError).toBe('network');
  });
});
