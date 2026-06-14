import chalk from 'chalk';
import { loadCredentials } from '../auth/credentials.js';
import { detectAdapter } from '../adapters/registry.js';
import { computeWrapped } from '../adapters/claude-code/wrapped.js';
import { FLAME, STAMP, MUT, FAINT, heat } from '../ui/theme.js';
import { formatTokens, receiptRow } from '../ui/helpers.js';

const W = 46;

export async function runWrapped(): Promise<void> {
  const creds = await loadCredentials();
  if (!creds) {
    console.log(chalk.hex(FAINT)('not linked. run: npx @codeclowns/cookd init'));
    return;
  }

  const adapter = await detectAdapter();
  if (!adapter) {
    console.log(chalk.hex(FAINT)('no agent detected.'));
    return;
  }

  const events = await adapter.events();
  const stats = computeWrapped(events, creds.handle);
  const pct = Math.round(stats.window.ratio * 100);
  const heatColor = heat(stats.window.ratio);

  console.log();
  console.log(chalk.hex(STAMP).bold('THE COOKD PRESS') + chalk.hex(FAINT)('  ·  USAGE ANATOMY'));
  console.log(chalk.hex(FAINT)(`@${creds.handle.toUpperCase()}`));
  console.log();
  console.log(chalk.hex(heatColor).bold(`${pct}%`) + chalk.hex(FAINT)(' of limit torched'));
  console.log();

  for (const row of stats.receiptLines) {
    console.log(chalk.hex(FAINT)(receiptRow(row.label, row.value, W)));
  }

  console.log();
}
