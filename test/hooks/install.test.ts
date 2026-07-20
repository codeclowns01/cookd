import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/hooks/binary.js', () => ({
  downloadBinary: vi.fn(),
  isBinaryInstalled: vi.fn(() => false),
  binaryPath: () => '/home/u/.cookd/bin/cookd',
}));
vi.mock('../../src/hooks/settings.js', () => ({
  installCookdHooks: vi.fn(),
  removeCookdHook: vi.fn(),
  claudeSettingsPath: () => '/home/u/.claude/settings.json',
}));

import { installAutoSync, uninstallAutoSync } from '../../src/hooks/install.js';
import { downloadBinary } from '../../src/hooks/binary.js';
import { installCookdHooks, removeCookdHook } from '../../src/hooks/settings.js';

describe('auto-sync install orchestration', () => {
  beforeEach(() => vi.clearAllMocks());

  it('downloads the binary then writes the hooks', async () => {
    await installAutoSync('1.2.3');
    expect(downloadBinary).toHaveBeenCalledWith('1.2.3');
    expect(installCookdHooks).toHaveBeenCalledWith('/home/u/.claude/settings.json', '/home/u/.cookd/bin/cookd');
  });

  it('does not write the hooks if the binary download fails', async () => {
    (downloadBinary as any).mockRejectedValueOnce(new Error('offline'));
    await expect(installAutoSync('1.2.3')).rejects.toThrow();
    expect(installCookdHooks).not.toHaveBeenCalled();
  });

  it('uninstall removes the hooks', async () => {
    await uninstallAutoSync();
    expect(removeCookdHook).toHaveBeenCalled();
  });
});
