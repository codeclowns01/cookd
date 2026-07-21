import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('../../src/hooks/install.js', () => ({ uninstallAutoSync: vi.fn() }));
import { runUninstall } from '../../src/commands/uninstall.js';
import { uninstallAutoSync } from '../../src/hooks/install.js';

describe('runUninstall', () => {
  beforeEach(() => vi.clearAllMocks());
  it('calls uninstallAutoSync', async () => {
    await runUninstall();
    expect(uninstallAutoSync).toHaveBeenCalledTimes(1);
  });
});
