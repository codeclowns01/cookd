import type { Credentials } from '../auth/credentials.js';

/** A returning, already-linked device should sync silently — no new press code. */
export function shouldSkipPressCode(creds: Credentials | null): boolean {
  return !!creds && typeof creds.deviceToken === 'string' && creds.deviceToken.length > 0;
}
