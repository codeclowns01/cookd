import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/sync/client.js', () => ({ syncWindowState: vi.fn() }));
vi.mock('../../src/adapters/registry.js', () => ({ detectAdapter: vi.fn() }));
vi.mock('../../src/auth/credentials.js', () => ({ saveCredentials: vi.fn() }));
vi.mock('../../src/adapters/claude-code/calibration-store.js', () => ({
  loadCalibration: () => ({ cpLimit: 1000, confidence: 'high', calibratedAt: 'now' }),
  saveCalibration: vi.fn(),
  isStale: () => false,
}));

import { runSyncOnce } from '../../src/sync/run.js';
import { syncWindowState } from '../../src/sync/client.js';
import { detectAdapter } from '../../src/adapters/registry.js';
import type { Credentials } from '../../src/auth/credentials.js';

const creds: Credentials = { deviceToken: 't', handle: 'you', deviceId: 'd', linkedAt: 'now' };

describe('runSyncOnce', () => {
  beforeEach(() => vi.clearAllMocks());

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
    expect(result.synced).toBe(true);
  });

  it('returns synced=false when no agent is detected', async () => {
    (detectAdapter as any).mockResolvedValue(null);
    const result = await runSyncOnce(creds);
    expect(syncWindowState).not.toHaveBeenCalled();
    expect(result.synced).toBe(false);
  });
});
