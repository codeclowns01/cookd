import { rmSync, existsSync } from 'fs';
import { join } from 'path';
import chalk from 'chalk';
import { COOKD_DIR } from '../auth/credentials.js';
import { FAINT, STAMP, MUT } from '../ui/theme.js';

/**
 * Release this machine — clear the local credentials, nothing else.
 *
 * Mandatory rather than convenience (ADR-012 decision 4 lineage): `--new-account`
 * was deliberately not built, which makes this the ONLY way to detach a laptop
 * from the account it is linked to. Without it, a machine holding a token could
 * never start a fresh account, because `init` always sends that token as the
 * bearer and `device-link-start` pre-authenticates the session to its owner.
 *
 * Local-only by design. The next `init` sends no bearer, so `preAuthedUserId`
 * stays null and the existing fresh-link branch creates the new account — no
 * server-side revocation needed. The `devices` row left behind is inert: it
 * cannot be used without the token that was just deleted.
 *
 * Deliberately does NOT remove the hooks or the binary — `cookd uninstall` owns
 * that, and conflating the two would make "I want a different account" silently
 * turn off auto-sync.
 */
export async function runLogout(): Promise<void> {
  const credsPath = join(COOKD_DIR, 'credentials.json');
  const wasLinked = existsSync(credsPath);
  rmSync(credsPath, { force: true });

  if (!wasLinked) {
    console.log(chalk.hex(FAINT)('  this machine wasn’t linked. nothing to do.'));
    return;
  }
  console.log(chalk.hex(STAMP).bold('  press pass surrendered.'));
  console.log(chalk.hex(FAINT)('  this laptop no longer reports to any account.'));
  console.log(chalk.hex(MUT)('  — auto-sync hooks are untouched (use: cookd uninstall).'));
  console.log(chalk.hex(MUT)('  — running cookd init now starts a NEW account. to get'));
  console.log(chalk.hex(MUT)('    back into the old one, link from the app instead.'));
}
