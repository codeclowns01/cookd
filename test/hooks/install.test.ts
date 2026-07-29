import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/hooks/binary.js', () => ({
  downloadBinary: vi.fn(),
  isBinaryInstalled: vi.fn(() => false),
  installedBinaryVersion: vi.fn(() => null),
  clearVersionMarker: vi.fn(),
  binaryPath: () => '/home/u/.cookd/bin/cookd',
}));
vi.mock('../../src/hooks/settings.js', () => ({
  installCookdHooks: vi.fn(),
  removeCookdHook: vi.fn(),
  claudeSettingsPath: () => '/home/u/.claude/settings.json',
}));

import { installAutoSync, uninstallAutoSync, needsBinaryUpgrade } from '../../src/hooks/install.js';
import { downloadBinary, isBinaryInstalled, installedBinaryVersion, clearVersionMarker } from '../../src/hooks/binary.js';
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

  it('uninstall removes the hooks and the version marker', async () => {
    await uninstallAutoSync();
    expect(removeCookdHook).toHaveBeenCalled();
    // Or a later reinstall would trust a marker describing a binary that is gone.
    expect(clearVersionMarker).toHaveBeenCalled();
  });
});

describe('the binary upgrade path (ADR 0009)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('REPLACES an installed binary when the version has moved on', () => {
    // The bug this fixes: `installAutoSync` used to skip the download whenever a
    // binary existed. `npx @codeclowns/cookd` always pulls the newest package,
    // but the hook runs the pinned binary in ~/.cookd/bin -- so re-running the
    // command looked like an upgrade and changed nothing, for ever.
    (isBinaryInstalled as any).mockReturnValue(true);
    (installedBinaryVersion as any).mockReturnValue('0.1.1');
    expect(needsBinaryUpgrade('0.2.0')).toBe(true);
  });

  it('treats an UNMARKED binary as stale', () => {
    // Everything installed before version tracking existed. Unknown must mean
    // old, or exactly the users who need the upgrade never get it.
    (isBinaryInstalled as any).mockReturnValue(true);
    (installedBinaryVersion as any).mockReturnValue(null);
    expect(needsBinaryUpgrade('0.2.0')).toBe(true);
  });

  it('leaves a current binary alone', () => {
    // ~60MB. Re-downloading it on every npx run would be its own bug.
    (isBinaryInstalled as any).mockReturnValue(true);
    (installedBinaryVersion as any).mockReturnValue('0.2.0');
    expect(needsBinaryUpgrade('0.2.0')).toBe(false);
  });

  it('installs when nothing is there at all', () => {
    (isBinaryInstalled as any).mockReturnValue(false);
    (installedBinaryVersion as any).mockReturnValue(null);
    expect(needsBinaryUpgrade('0.2.0')).toBe(true);
  });

  it('re-downloads through installAutoSync when the version moved', async () => {
    (isBinaryInstalled as any).mockReturnValue(true);
    (installedBinaryVersion as any).mockReturnValue('0.1.1');
    await installAutoSync('0.2.0');
    expect(downloadBinary).toHaveBeenCalledWith('0.2.0');
  });

  it('skips the download through installAutoSync when it is already current', async () => {
    (isBinaryInstalled as any).mockReturnValue(true);
    (installedBinaryVersion as any).mockReturnValue('0.2.0');
    await installAutoSync('0.2.0');
    expect(downloadBinary).not.toHaveBeenCalled();
    // ...but the hooks are still (idempotently) written, so a user who removed
    // them by hand gets them back without a 60MB round trip.
    expect(installCookdHooks).toHaveBeenCalled();
  });
});
