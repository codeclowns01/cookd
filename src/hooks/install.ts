import { rmSync, existsSync } from 'fs';
import {
  downloadBinary, binaryPath, isBinaryInstalled, installedBinaryVersion, clearVersionMarker,
} from './binary.js';
import { installCookdHooks, removeCookdHook, claudeSettingsPath } from './settings.js';

/** Should `npx @codeclowns/cookd` replace what is already in ~/.cookd/bin? */
export function needsBinaryUpgrade(version: string): boolean {
  if (!isBinaryInstalled()) return true;
  // An unmarked binary predates version tracking, so it is by definition older
  // than any release that writes a marker. Unknown counts as stale.
  return installedBinaryVersion() !== version;
}

/**
 * Provision the binary, then register the hooks. Order matters: never write a hook
 * pointing at a binary that isn't there. Throws on failure (caller shows the error and
 * defers auto-sync — nothing partial is left behind that would fire a broken hook).
 *
 * ———————————————————————————————————————————————————————————————————————
 * WHY THIS RE-DOWNLOADS ON A VERSION CHANGE
 * ———————————————————————————————————————————————————————————————————————
 *
 * This used to read `if (!isBinaryInstalled()) await downloadBinary(version)`,
 * which meant an existing install was NEVER replaced. `npx @codeclowns/cookd`
 * always fetches the latest package, but the hook does not run the package — it
 * runs the pinned binary at ~/.cookd/bin/cookd. So a user who consented to
 * auto-sync once kept firing that same binary for ever, and re-running the
 * command appeared to upgrade them while changing nothing.
 *
 * That is load-bearing for ADR 0009. A pre-bucket binary sends no `buckets`, so
 * the server never writes `synced_at`, so the account reads as permanently
 * `stale` — and a stale device never locks the user out. Without this fix every
 * existing user would have sat on unrestricted access indefinitely with no way
 * to opt back in, because the documented remedy ("re-run the command") was a
 * no-op.
 *
 * With it, the loop closes: the projection sees a null/old `companion_version`
 * and reports `version_too_old`, the recovery screen tells the user to run
 * `npx @codeclowns/cookd`, and that command now actually replaces the binary.
 */
export async function installAutoSync(version: string): Promise<void> {
  if (needsBinaryUpgrade(version)) await downloadBinary(version);
  installCookdHooks(claudeSettingsPath(), binaryPath());
}

export async function uninstallAutoSync(): Promise<void> {
  removeCookdHook(claudeSettingsPath());
  const bin = binaryPath();
  if (existsSync(bin)) rmSync(bin, { force: true });
  // Or a later reinstall would trust a marker describing a binary that is gone.
  clearVersionMarker();
}
