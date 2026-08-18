import { describe, it, expect } from 'vitest';
import { resolveRelink } from '../../src/commands/init-guard.js';
import {
  healthFromOutcome, resyncLine, relinkLines, revokedLines,
} from '../../src/ui/ink/Relink.js';

/**
 * ADR-012. The press code is cookd's ONLY credential, so a branch that withholds
 * it is an account-recovery outage. These tests pin the two properties that
 * matter most: a code is always obtainable, and nothing is ever claimed that the
 * run did not actually establish.
 */
describe('healthFromOutcome — only a real push proves anything', () => {
  it('treats an accepted push as proof the token is alive', () => {
    expect(healthFromOutcome('ok')).toBe('alive');
  });
  it('treats a 401 as proof the token is dead', () => {
    expect(healthFromOutcome('token_rejected')).toBe('dead');
  });
  it.each(['network', 'unchanged', 'gated', 'no_adapter'] as const)(
    'treats %s as unknown — it proves nothing either way', (outcome) => {
      expect(healthFromOutcome(outcome)).toBe('unknown');
    });
});

describe('resyncLine — never claims a sync that did not happen', () => {
  it('only says "synced." when the server actually accepted it', () => {
    expect(resyncLine('ok')).toBe('synced.');
  });
  it('does not say "synced." when the gates short-circuited before any HTTP', () => {
    expect(resyncLine('unchanged')).toBe('nothing new to send.');
    expect(resyncLine('gated')).toBe('nothing new to send.');
  });
  it('names a refused pass instead of reporting success', () => {
    expect(resyncLine('token_rejected')).toContain('refused');
  });
  it('makes no claim at all when there is no agent', () => {
    expect(resyncLine('no_adapter')).toBeNull();
  });
});

describe('resolveRelink', () => {
  it('leaves a first-time link untouched — no banner, code as always', () => {
    const d = resolveRelink({ alreadyLinked: false, health: 'unknown', outcome: null, handle: null });
    expect(d.shouldPrintCode).toBe(true);
    expect(d.requiresConfirm).toBe(false);
    expect(d.bannerLines).toEqual([]);
  });

  // The whole point of ADR-012: being linked is never a reason to withhold.
  it.each(['alive', 'dead', 'unknown'] as const)(
    'always offers a code to a linked device (health: %s)', (health) => {
      const d = resolveRelink({ alreadyLinked: true, health, outcome: 'ok', handle: 'kanwar' });
      expect(d.shouldPrintCode).toBe(true);
    });

  it('confirms ONLY on a proven-dead token', () => {
    const dead = resolveRelink({ alreadyLinked: true, health: 'dead', outcome: 'token_rejected', handle: 'k' });
    expect(dead.requiresConfirm).toBe(true);
    for (const health of ['alive', 'unknown'] as const) {
      expect(resolveRelink({ alreadyLinked: true, health, outcome: 'ok', handle: 'k' }).requiresConfirm).toBe(false);
    }
  });

  /**
   * Eng-review E1 made this reachable: before `force`, a healthy hook-installed
   * machine returned `unchanged` and would have been treated as unproven, firing
   * the account-loss warning on nearly every run.
   */
  it('does not dress an unconfirmed link up as healthy', () => {
    const d = resolveRelink({ alreadyLinked: true, health: 'unknown', outcome: 'network', handle: 'k' });
    const text = d.bannerLines.join(' ');
    expect(text).toMatch(/can.t confirm/i);
    expect(text).not.toMatch(/✓/);
  });
});

describe('revoked-token copy (DD4)', () => {
  const text = revokedLines().join(' ');

  it('does not claim the pass was revoked — the app hard-deletes, so we cannot know', () => {
    expect(text).toMatch(/isn.t recognised/i);
    expect(text.toLowerCase()).not.toContain('revoked');
  });

  it('names every loss in the user\'s own vocabulary', () => {
    for (const word of ['handle', 'history', 'badges', 'streaks']) {
      expect(text.toLowerCase()).toContain(word);
    }
  });

  it('states plainly that continuing starts a new account', () => {
    expect(text).toMatch(/NEW account/);
  });
});

describe('handle hedging (DD6)', () => {
  it('hedges the cached handle — a live rename can make it stale', () => {
    const text = relinkLines('alive', 'kanwar').join(' ');
    expect(text).toContain('last known as @kanwar');
  });
  it('says nothing about identity when there is no handle to show', () => {
    expect(relinkLines('alive', null).join(' ')).not.toContain('@');
  });
});
