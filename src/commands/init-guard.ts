import type { Credentials } from '../auth/credentials.js';
import type { SyncOutcome } from '../sync/run.js';
import {
  relinkLines, revokedLines, resyncLine, type LinkHealth,
} from '../ui/ink/Relink.js';

export type { LinkHealth };

/** Does this machine already hold a usable device token? */
export function isAlreadyLinked(creds: Credentials | null): boolean {
  return !!creds && typeof creds.deviceToken === 'string' && creds.deviceToken.length > 0;
}

/** How `InitApp` finished. `resynced` is an already-linked device that re-synced
 *  and was offered a press code, but did not complete a new link. */
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

/**
 * The one relink decision, shared by BOTH init flows (ADR-012 decision 9).
 *
 * Pure: no I/O, no chalk, no Ink. Renderers apply theme; this decides meaning.
 * The Ink and plain flows have drifted three times — most recently within a
 * single diff, where one path reported the resync result and the other lied
 * about it. A shared pure function is the structural fix; duplicated literals
 * were the mechanism.
 */
export interface RelinkDecision {
  /** Show the revoked-token confirmation before minting anything. */
  requiresConfirm: boolean;
  /** Mint and display a press code (unless the user declines the confirm). */
  shouldPrintCode: boolean;
  /** One honest line about the re-sync, or null when there is no claim to make. */
  resyncLine: string | null;
  /** Banner above the code. Empty for a first-time link — that flow has its own ceremony. */
  bannerLines: string[];
}

export function resolveRelink(input: {
  alreadyLinked: boolean;
  health: LinkHealth;
  outcome: SyncOutcome | null;
  handle: string | null;
}): RelinkDecision {
  const { alreadyLinked, health, outcome, handle } = input;

  // A fresh device keeps the original press-code ceremony untouched.
  if (!alreadyLinked) {
    return { requiresConfirm: false, shouldPrintCode: true, resyncLine: null, bannerLines: [] };
  }

  // Fail safe: only a proven-dead token triggers the confirmation, but an
  // 'unknown' result must NOT be dressed up as healthy — it gets the hedged
  // banner instead (DD3 state 4). Neither claims what it cannot support.
  return {
    requiresConfirm: health === 'dead',
    shouldPrintCode: true,
    resyncLine: outcome ? resyncLine(outcome) : null,
    bannerLines: health === 'dead' ? revokedLines() : relinkLines(health, handle),
  };
}
