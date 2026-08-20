import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { pollForLink } from '../../src/auth/device-link.js';
import type { Credentials } from '../../src/auth/credentials.js';

/**
 * ADR-012 T3 / regression R2.
 *
 * `pollForLink` built a fresh 4-field Credentials while the interface carries
 * six. The two sync watermarks were silently dropped, and `watch.ts` keys off
 * `!lastWrappedSync` to decide whether to re-push the ENTIRE lifetime history
 * through the direct-POST bypass.
 *
 * This was unreachable while the re-init guard kept already-linked devices away
 * from this function. Removing that guard is precisely what woke it — which is
 * why the fix ships in the same increment, not after.
 */
const existing: Credentials = {
  deviceToken: 'cookd_old',
  handle: 'kanwar',
  deviceId: 'device-1',
  linkedAt: '2026-01-01T00:00:00.000Z',
  lastWrappedSync: '2026-08-01T00:00:00.000Z',
  lastCookedEventSentAt: '2026-08-17T00:00:00.000Z',
};

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(
    JSON.stringify({ status: 'linked', handle: 'kanwar' }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )));
});
afterEach(() => vi.unstubAllGlobals());

describe('pollForLink credential preservation', () => {
  it('keeps both sync watermarks across a reauth relink', async () => {
    const creds = await pollForLink('device-1', 'sess', () => {}, existing, 1, 5_000);
    expect(creds).not.toBeNull();
    expect(creds!.lastWrappedSync).toBe(existing.lastWrappedSync);
    expect(creds!.lastCookedEventSentAt).toBe(existing.lastCookedEventSentAt);
  });

  it('keeps the existing device token when reauth returns none', async () => {
    // The reauth branch of device-link-confirm deliberately returns no new
    // token; without this fallback every recovery would null out the credential.
    const creds = await pollForLink('device-1', 'sess', () => {}, existing, 1, 5_000);
    expect(creds!.deviceToken).toBe('cookd_old');
  });

  it('honours a short poll leash instead of blocking for ten minutes', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ status: 'pending' }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )));
    const started = Date.now();
    const creds = await pollForLink('device-1', 'sess', () => {}, existing, 10, 120);
    expect(creds).toBeNull();
    expect(Date.now() - started).toBeLessThan(3_000);
  });
});
