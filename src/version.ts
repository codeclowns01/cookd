/**
 * The companion's own version, as a compiled-in constant.
 *
 * Not read from package.json at runtime: the hook invokes a bun-compiled single
 * binary at `~/.cookd/bin/cookd`, which has no package.json beside it. A lookup
 * that works in development and returns undefined in the one context that
 * matters is worse than no lookup.
 *
 * `test/version.test.ts` pins this against package.json so the two cannot drift.
 */
export const COOKD_VERSION = '0.2.0';
