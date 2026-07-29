import { describe, it, expect } from 'vitest';
import { shouldSkipPressCode, shouldOfferAutoSync } from '../../src/commands/init-guard.js';

describe('shouldSkipPressCode', () => {
  it('true when valid credentials exist', () => {
    expect(shouldSkipPressCode({ deviceToken: 't', handle: 'you', deviceId: 'd', linkedAt: 'now' })).toBe(true);
  });
  it('false when no credentials', () => {
    expect(shouldSkipPressCode(null)).toBe(false);
  });
  it('false when credentials are missing a device token', () => {
    expect(shouldSkipPressCode({ handle: 'you', deviceId: 'd', linkedAt: 'now' } as any)).toBe(false);
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
