import { describe, it, expect } from 'vitest';
import { isAlreadyLinked, shouldOfferAutoSync } from '../../src/commands/init-guard.js';

describe('isAlreadyLinked', () => {
  it('true when a device token is present', () => {
    expect(isAlreadyLinked({ deviceToken: 't', handle: 'you', deviceId: 'd', linkedAt: 'now' })).toBe(true);
  });
  it('false when no credentials', () => {
    expect(isAlreadyLinked(null)).toBe(false);
  });
  it('false when credentials are missing a device token', () => {
    expect(isAlreadyLinked({ handle: 'you', deviceId: 'd', linkedAt: 'now' } as any)).toBe(false);
  });
  it('false on an empty device token', () => {
    expect(isAlreadyLinked({ deviceToken: '', handle: 'you', deviceId: 'd', linkedAt: 'now' })).toBe(false);
  });
});

/**
 * Journal defect B2: the re-init guard resolved 'other' while the auto-sync
 * offer was gated on 'linked', so an already-linked device could never be
 * offered the hook — the exact population that needs it.
 */
describe('shouldOfferAutoSync', () => {
  it('offers after a fresh link', () => {
    expect(shouldOfferAutoSync('linked')).toBe(true);
  });
  it('offers after an already-linked device re-syncs (B2 regression)', () => {
    expect(shouldOfferAutoSync('resynced')).toBe(true);
  });
  it('does not offer when init ended without linking', () => {
    expect(shouldOfferAutoSync('other')).toBe(false);
  });
});

/**
 * Journal defect B3: `isAlreadyLinked` used to be named `shouldSkipPressCode`
 * and was wired straight to an early return, so a machine holding ANY device
 * token could never obtain a press code again. A tester who reinstalls the app
 * and signs into a different account has a live token pointed at the old
 * account — nothing is detectably broken, and the one action that fixes it was
 * unreachable. The predicate now answers "is this a relink?", never "skip the
 * code", and the press code is always issued.
 */
describe('B3 — being linked is not a reason to withhold a press code', () => {
  it('is a question about credentials, not about control flow', () => {
    const creds = { deviceToken: 't', handle: 'you', deviceId: 'd', linkedAt: 'now' };
    // A linked device is a RELINK candidate, and a relink still ends in one of
    // the two outcomes that get the auto-sync offer.
    expect(isAlreadyLinked(creds)).toBe(true);
    expect(shouldOfferAutoSync('resynced')).toBe(true);
    expect(shouldOfferAutoSync('linked')).toBe(true);
  });
});
