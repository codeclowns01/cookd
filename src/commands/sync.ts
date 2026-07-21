import { loadCredentials } from '../auth/credentials.js';
import { runSyncOnce } from '../sync/run.js';

/**
 * Headless one-shot sync. Invoked by the SessionStart/SessionEnd hooks (and reusable
 * manually). Fails quietly: a hook must never break the user's Claude session, and any
 * unsent events stay durably queued for the next sync.
 */
export async function runSync(): Promise<void> {
  try {
    const creds = await loadCredentials();
    if (!creds) return; // not linked — nothing to do
    await runSyncOnce(creds);
  } catch {
    // swallow: queued events retry on the next sync; never crash the hook
  }
}
