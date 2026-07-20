import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/auth/credentials.js', () => ({ loadCredentials: vi.fn() }));
vi.mock('../../src/sync/run.js', () => ({ runSyncOnce: vi.fn() }));

import { runSync } from '../../src/commands/sync.js';
import { loadCredentials } from '../../src/auth/credentials.js';
import { runSyncOnce } from '../../src/sync/run.js';

describe('runSync (cookd sync)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('does nothing when not linked (no throw, no sync)', async () => {
    (loadCredentials as any).mockResolvedValue(null);
    await runSync();
    expect(runSyncOnce).not.toHaveBeenCalled();
  });

  it('runs one sync when linked', async () => {
    (loadCredentials as any).mockResolvedValue({ deviceToken: 't', handle: 'you', deviceId: 'd', linkedAt: 'now' });
    (runSyncOnce as any).mockResolvedValue({ synced: true, creds: {} });
    await runSync();
    expect(runSyncOnce).toHaveBeenCalledTimes(1);
  });

  it('never throws even if the sync path fails (hook safety)', async () => {
    (loadCredentials as any).mockResolvedValue({ deviceToken: 't', handle: 'you', deviceId: 'd', linkedAt: 'now' });
    (runSyncOnce as any).mockRejectedValue(new Error('network down'));
    await expect(runSync()).resolves.toBeUndefined();
  });
});
