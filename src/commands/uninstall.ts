import chalk from 'chalk';
import { uninstallAutoSync } from '../hooks/install.js';
import { FAINT, STAMP } from '../ui/theme.js';

export async function runUninstall(): Promise<void> {
  await uninstallAutoSync();
  console.log(chalk.hex(STAMP).bold('  auto-sync removed.'));
  console.log(chalk.hex(FAINT)('  the auto-sync hooks and local binary are gone. your account is untouched.'));
}
