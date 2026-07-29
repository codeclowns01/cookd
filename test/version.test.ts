/**
 * The compiled-in version must be the published version.
 *
 * `COOKD_VERSION` cannot be read from package.json at runtime — the hook runs a
 * bun-compiled single binary with no package.json beside it. That makes drift
 * possible, and drift here is not cosmetic: the server uses the reported version
 * to decide whether to tell a user their companion is too old (migration 0024,
 * `version_too_old`). A stale constant would either accuse a current install or
 * excuse an ancient one.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { COOKD_VERSION } from '../src/version.js';

describe('COOKD_VERSION', () => {
  it('matches package.json', () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as { version: string };
    expect(COOKD_VERSION).toBe(pkg.version);
  });

  it('is at least the floor the server enforces', () => {
    // `public.min_companion_version()` in cookd-app migration 0024. A release
    // below this floor would report itself as too old on every sync.
    const floor = [0, 2, 0];
    const parts = COOKD_VERSION.split('-')[0].split('.').map(Number);
    const atLeast =
      parts[0] > floor[0] ||
      (parts[0] === floor[0] && (parts[1] > floor[1] || (parts[1] === floor[1] && parts[2] >= floor[2])));
    expect(atLeast).toBe(true);
  });
});
