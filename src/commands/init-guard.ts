import type { Credentials } from '../auth/credentials.js';

/** A returning, already-linked device should sync silently — no new press code. */
export function shouldSkipPressCode(creds: Credentials | null): boolean {
  return !!creds && typeof creds.deviceToken === 'string' && creds.deviceToken.length > 0;
}

/** How `InitApp` finished. `resynced` is an already-linked device that re-synced
 *  silently without a press code. */
export type InitOutcome = 'linked' | 'resynced' | 'other';

/**
 * Whether this outcome should be followed by the auto-sync hook offer.
 *
 * Journal defect B2: the re-init guard resolved `'other'`, and the offer was
 * gated on `'linked'` only — so an already-linked device could **never** be
 * offered the hook. That is exactly the population that needs it, since anyone
 * who linked before auto-sync existed is already-linked by definition.
 */
export function shouldOfferAutoSync(outcome: InitOutcome): boolean {
  return outcome === 'linked' || outcome === 'resynced';
}
