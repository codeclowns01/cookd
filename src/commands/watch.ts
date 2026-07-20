import chalk from 'chalk';
import { loadCredentials, saveCredentials } from '../auth/credentials.js';
import { detectAdapter } from '../adapters/registry.js';
import { computeWindow, WINDOW_MS } from '../adapters/claude-code/window.js';
import { calibrate } from '../adapters/claude-code/calibrate.js';
import { computeLifetimeStats } from '../adapters/claude-code/wrapped.js';
import { loadCalibration, saveCalibration, isStale } from '../adapters/claude-code/calibration-store.js';
import { syncLifetimeStats } from '../sync/client.js';
import { runSyncOnce } from '../sync/run.js';
import { STAMP, MUT, FAINT } from '../ui/theme.js';

function isOlderThan7Days(isoString: string): boolean {
  return Date.now() - new Date(isoString).getTime() > 7 * 24 * 60 * 60 * 1000;
}

export async function runWatch(): Promise<void> {
  let creds = await loadCredentials();
  if (!creds) {
    console.log(chalk.hex(FAINT)('not linked. run: npx @codeclowns/cookd init'));
    process.exit(1);
  }

  const adapter = await detectAdapter();
  if (!adapter) {
    console.log(chalk.hex(FAINT)('no agent detected.'));
    process.exit(1);
  }

  const initialEvents = await adapter.events();
  const stored = loadCalibration();
  if (!stored || isStale(stored)) {
    const result = calibrate(initialEvents);
    saveCalibration({
      cpLimit: result.cpLimit,
      confidence: result.confidence,
      calibratedAt: new Date().toISOString(),
    });
  }

  if (!creds.lastWrappedSync || isOlderThan7Days(creds.lastWrappedSync)) {
    try {
      await syncLifetimeStats(creds, computeLifetimeStats(initialEvents));
      creds = { ...creds, lastWrappedSync: new Date().toISOString() };
      await saveCredentials(creds);
      process.stdout.write(chalk.hex(FAINT)('  wrapped synced\n'));
    } catch {
      // non-fatal
    }
  }

  console.log(chalk.hex(STAMP).bold(`@${creds.handle.toUpperCase()}`) + chalk.hex(FAINT)('  field reporter active'));
  console.log(chalk.hex(MUT).italic('— watching for usage. ctrl+c to stop.'));
  console.log();

  let debounce: ReturnType<typeof setTimeout> | null = null;
  let lastSyncedPct = -1;
  let lastSyncTime = 0;

  // Initial sync on startup — push current state without waiting for a file change
  try {
    const res = await runSyncOnce(creds);
    creds = res.creds;
    lastSyncTime = Date.now();
    process.stdout.write(chalk.hex(FAINT)('  synced\n'));
  } catch {
    process.stdout.write(chalk.hex(FAINT)('  initial sync failed\n'));
  }

  const stop = adapter.watch(() => {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(async () => {
      try {
        const events = await adapter.events();
        const limit = loadCalibration()?.cpLimit ?? null;
        const window = computeWindow(events, limit);

        const newPct = limit != null ? Math.round(window.ratio * 100) : 0;
        const now = Date.now();
        const hasRLEvent = events.some(e => e.limitResetAt && e.ts.getTime() > now - WINDOW_MS);
        const bigChange = Math.abs(newPct - lastSyncedPct) >= 2;
        const heartbeat = now - lastSyncTime >= 5 * 60 * 1000;
        if (!bigChange && !hasRLEvent && !heartbeat) return;

        const res = await runSyncOnce(creds!);
        creds = res.creds;
        lastSyncedPct = newPct;
        lastSyncTime = Date.now();
        process.stdout.write(chalk.hex(FAINT)('.'));
      } catch {
        process.stdout.write(chalk.hex(FAINT)('x'));
      }
    }, 15_000);
  });

  process.on('SIGINT', () => {
    stop();
    console.log();
    console.log(chalk.hex(FAINT)('  transmission closed.'));
    process.exit(0);
  });
}
