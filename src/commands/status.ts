import chalk from 'chalk';
import { loadCredentials } from '../auth/credentials.js';
import { detectAdapter } from '../adapters/registry.js';
import { computeWindow } from '../adapters/claude-code/window.js';
import { calibrate } from '../adapters/claude-code/calibrate.js';
import { loadCalibration, saveCalibration, isStale } from '../adapters/claude-code/calibration-store.js';
import { FLAME, STAMP, MUT, FAINT } from '../ui/theme.js';
import { formatTokens, formatDuration, receiptRow } from '../ui/helpers.js';

const W = 46;

export async function runStatus(): Promise<void> {
  const creds = await loadCredentials();
  if (!creds) {
    console.log(chalk.hex(FAINT)('not linked. run: npx cookd init'));
    return;
  }

  const adapter = await detectAdapter();
  if (!adapter) {
    console.log(chalk.hex(FAINT)('no agent detected.'));
    return;
  }

  const events = await adapter.events();

  let limit: number | null = null;
  const stored = loadCalibration();
  if (stored && !isStale(stored)) {
    limit = stored.cpLimit;
  } else {
    const result = calibrate(events);
    saveCalibration({
      cpLimit: result.cpLimit,
      confidence: result.confidence,
      calibratedAt: new Date().toISOString(),
    });
    limit = result.cpLimit;
  }

  const window = computeWindow(events, limit);
  const pct = limit ? Math.round(window.ratio * 100) : null;

  console.log();
  console.log(chalk.hex(STAMP).bold(`@${creds.handle.toUpperCase()}`));
  console.log();

  if (pct !== null) {
    console.log(chalk.hex(FLAME).bold(`${pct}%`) + chalk.hex(FAINT)(' of limit torched'));
  } else {
    console.log(chalk.hex(FAINT)('calibrating... run again after a rate-limit session'));
  }

  console.log();
  console.log(chalk.hex(FAINT)(receiptRow('WEIGHTED', formatTokens(window.weightedTokens), W)));
  console.log(chalk.hex(FAINT)(receiptRow('INPUT',    formatTokens(window.inputTokens), W)));
  console.log(chalk.hex(FAINT)(receiptRow('OUTPUT',   formatTokens(window.outputTokens), W)));
  console.log(chalk.hex(FAINT)(receiptRow('CACHE R',  formatTokens(window.cacheReadTokens), W)));
  console.log(chalk.hex(FAINT)(receiptRow('CACHE W',  formatTokens(window.cacheCreationTokens), W)));
  console.log();
  console.log(chalk.hex(MUT).italic(`window expires in ${formatDuration(window.msUntilExpiry)}`));
  console.log();
}
