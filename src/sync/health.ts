import { claudeSettingsPath, hasCookdHook } from '../hooks/settings.js';
import { COOKD_VERSION } from '../version.js';

/**
 * What the companion reports about ITSELF on each sync (ADR 0009 / design DD2).
 *
 * The app's recovery screen has to tell failure cases apart — an old companion,
 * a missing hook, a rejected token, and a laptop that simply went quiet all look
 * identical from the server's side, and a screen that cannot tell them apart can
 * only say "something is wrong", which wastes the user's time at the exact
 * moment they most need a way forward.
 *
 * Counts-not-names still holds (NFR4): a version string, a boolean, and a code
 * from a closed enum. No paths, no project names, nothing about the machine.
 */
export interface CompanionHealth {
  companionVersion: string;
  /** Whether auto-sync is actually wired into ~/.claude/settings.json. */
  hooksInstalled: boolean;
  /**
   * The failure the LAST push hit, reported now that a push is succeeding.
   *
   * Necessarily after the fact: a companion that cannot reach the server cannot
   * tell the server it could not reach the server. So this catches transient
   * faults that recovered, and a permanently rejected token — which can never
   * reach this function at all — surfaces to the app as `laptop_silent` instead.
   * That gap is real and is recorded rather than papered over.
   */
  lastError: PushFailure | null;
}

/** Closed set, mirrored by `DEVICE_ERROR_CODES` in usage-ingest/pure.ts. */
export type PushFailure = 'token_rejected' | 'network' | 'scan_failed';

export function readHealth(lastError: PushFailure | null): CompanionHealth {
  let hooksInstalled = false;
  try {
    hooksInstalled = hasCookdHook(claudeSettingsPath());
  } catch {
    // An unparseable settings.json is a real condition the installer refuses to
    // touch. It is not a reason to fail a sync, and reporting "not installed"
    // is the safer read — it points the user at the file either way.
    hooksInstalled = false;
  }
  return { companionVersion: COOKD_VERSION, hooksInstalled, lastError };
}
