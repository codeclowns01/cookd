import { STAMP, MUT, FAINT, FLAME } from '../theme.js';
import type { SyncOutcome } from '../../sync/run.js';

/**
 * The copy for a returning device, as pure data (ADR-012 / design delta DD2).
 *
 * Mirrors `Consent.tsx`: a pure `string[]` builder plus a separate colour
 * function. That split is what makes Ink/plain-TTY parity structural instead of
 * a discipline problem — one copy source, two renderers. The previous shape,
 * copy inlined as literals in both flows, had already drifted three times.
 *
 * Colour may never be the only signal: the plain flow is monochrome, so every
 * meaning here survives as words.
 */

/** What we actually know about this laptop's credentials, this run. */
export type LinkHealth =
  | 'alive'       // the server accepted a push just now — proof
  | 'dead'        // 401 — proof of the opposite
  | 'unknown';    // network failure or nothing to send — proves nothing

/**
 * Map a sync outcome to what it proves.
 *
 * Only 'ok' proves the token is alive, and only after a FORCED push — the gated
 * outcomes return before any HTTP, so on a non-forced run they are 'unknown'
 * rather than reassuring. `init` always forces (E1), so in practice it sees
 * 'alive' or 'dead'.
 */
export function healthFromOutcome(outcome: SyncOutcome): LinkHealth {
  if (outcome === 'ok') return 'alive';
  if (outcome === 'token_rejected') return 'dead';
  return 'unknown';
}

/** One line of the resync report, or null when there is nothing honest to say. */
export function resyncLine(outcome: SyncOutcome): string | null {
  switch (outcome) {
    case 'ok': return 'synced.';
    case 'unchanged':
    case 'gated': return 'nothing new to send.';
    case 'token_rejected': return 'this laptop’s press pass was refused.';
    case 'network': return 'couldn’t reach the press.';
    case 'no_adapter': return null; // no claim to make
  }
}

/**
 * The banner above a relink press code.
 *
 * `handle` is HEDGED as "last known as" until the server can name the account in
 * the same request that mints the code (DD6). `RapSheet.tsx` ships a live handle
 * rename, so the cached value in credentials.json can be stale — and an
 * unhedged stale handle on an identity operation is exactly what ADR-012's
 * "codes redeemed into the wrong account = 0" guardrail forbids.
 */
export function relinkLines(health: LinkHealth, handle: string | null): string[] {
  const who = handle ? `last known as @${handle}` : 'this laptop is on record';
  switch (health) {
    case 'alive':
      return [
        `✓ ${who} — synced.`,
        '',
        'need to sign the app in again? use the code below.',
        'if everything already looks right, you’re done — ignore it.',
      ];
    case 'unknown':
      return [
        `couldn’t reach the press — can’t confirm this laptop’s pass.`,
        '',
        'a code is below, but if the pass was cancelled,',
        'using it starts a NEW account. reconnect first if you can.',
      ];
    case 'dead':
      // Never reached: 'dead' routes through the confirmation instead.
      return revokedLines();
  }
}

/**
 * The revoked-token confirmation — the highest-stakes screen in the product
 * (design delta DD4). Shown BEFORE any code is printed; declining mints nothing.
 *
 * Says "isn't recognised", never "revoked": the app hard-DELETEs the device row,
 * so a removed device and one that never existed are genuinely indistinguishable.
 * Claiming to know which is the same dishonesty this ADR exists to remove.
 */
export function revokedLines(): string[] {
  return [
    'YOUR PRESS PASS ISN’T RECOGNISED.',
    '',
    'this laptop’s credentials don’t match any device',
    'on record. that usually means the device was',
    'removed from your rap sheet, or the machine was',
    're-imaged.',
    '',
    'what happens if you continue:',
    '  · you’ll get a press code',
    '  · redeeming it starts a NEW account',
    '  · your handle, history, badges and streaks',
    '    do NOT come with you',
    '  · the old account can’t be reached from here',
  ];
}

/** Headline in STAMP, consequence bullets in MUT, prose in FAINT — mirrors `consentColorFor`. */
export function relinkColorFor(line: string, index: number): string {
  if (index === 0) return line.startsWith('YOUR PRESS PASS') ? FLAME : STAMP;
  if (line.trimStart().startsWith('·')) return MUT;
  return FAINT;
}
