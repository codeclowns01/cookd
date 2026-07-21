import { rmSync, existsSync } from 'fs';
import { downloadBinary, binaryPath, isBinaryInstalled } from './binary.js';
import { installCookdHooks, removeCookdHook, claudeSettingsPath } from './settings.js';

/**
 * Provision the binary, then register the hooks. Order matters: never write a hook
 * pointing at a binary that isn't there. Throws on failure (caller shows the error and
 * defers auto-sync — nothing partial is left behind that would fire a broken hook).
 */
export async function installAutoSync(version: string): Promise<void> {
  if (!isBinaryInstalled()) await downloadBinary(version);
  installCookdHooks(claudeSettingsPath(), binaryPath());
}

export async function uninstallAutoSync(): Promise<void> {
  removeCookdHook(claudeSettingsPath());
  const bin = binaryPath();
  if (existsSync(bin)) rmSync(bin, { force: true });
}
