import chalk from 'chalk';
import { loadCredentials, saveCredentials } from '../auth/credentials.js';
import { detectAdapter } from '../adapters/registry.js';
import { ClaudeCodeAdapter } from '../adapters/claude-code/index.js';
import { computeWindow, WINDOW_MS } from '../adapters/claude-code/window.js';
import { calibrate, extractLatestResetTime } from '../adapters/claude-code/calibrate.js';
import { computeModelBreakdown, computeDailyStats, computeLifetimeStats, computeTonight } from '../adapters/claude-code/wrapped.js';
import { loadCalibration, saveCalibration, isStale } from '../adapters/claude-code/calibration-store.js';
import { syncWindowState, syncLifetimeStats } from '../sync/client.js';
import type { WindowSummary, SessionStatus, CookedEventPayload } from '../sync/events.js';
import type { UsageEvent } from '../adapters/types.js';
import { STAMP, MUT, FAINT } from '../ui/theme.js';

function deriveStatus(ratio: number, limit: number | null): SessionStatus {
  if (!limit || ratio < 0.1) return 'idle';
  if (ratio >= 0.95) return 'cookd';
  return 'cooking';
}

function toLocalDate(d: Date): string {
  return d.toLocaleDateString('en-CA');
}

function isOlderThan7Days(isoString: string): boolean {
  return Date.now() - new Date(isoString).getTime() > 7 * 24 * 60 * 60 * 1000;
}

export async function runWatch(): Promise<void> {
  let creds = await loadCredentials();
  if (!creds) {
    console.log(chalk.hex(FAINT)('not linked. run: npx @codeclowns/cookd init'));
    process.exit(1);
  }
  let lastCookedEventSentAt = creds.lastCookedEventSentAt ?? null;

  const adapter = await detectAdapter();
  if (!adapter) {
    console.log(chalk.hex(FAINT)('no agent detected.'));
    process.exit(1);
  }

  const ccAdapter = adapter instanceof ClaudeCodeAdapter ? adapter : null;

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
      const lifetimeStats = computeLifetimeStats(initialEvents);
      await syncLifetimeStats(creds, lifetimeStats);
      await saveCredentials({ ...creds, lastWrappedSync: new Date().toISOString() });
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

  async function syncNow(events: UsageEvent[]) {
    const calState = loadCalibration();
    const limit = calState?.cpLimit ?? null;
    const window = computeWindow(events, limit);

    const newPct = limit != null ? Math.round(window.ratio * 100) : 0;
    const resetFromError = extractLatestResetTime(events);
    const oldestWindowEvent = window.events[0];
    const resetsAt = resetFromError?.toISOString()
      ?? (oldestWindowEvent ? new Date(oldestWindowEvent.ts.getTime() + WINDOW_MS).toISOString() : null);

    const sessionStats = ccAdapter?.getSessionStats() ?? { prompts: 0, yoloPrompts: 0, toolCounts: {}, toolErrors: 0 };

    const summary: WindowSummary = {
      status: deriveStatus(window.ratio, limit),
      usedTokens: window.weightedTokens,
      limitTokens: limit,
      pctUsed: limit != null ? window.ratio * 100 : null,
      windowStart: window.windowStart.toISOString(),
      resetsAt,
      plan: null,
      calibrationConfidence: calState?.confidence ?? 'none',
      modelBreakdown: Object.fromEntries(computeModelBreakdown(window.events).map(s => [s.model, s.cpTokens])),
      dailyStats: computeDailyStats(events, toLocalDate(new Date()), limit != null ? window.ratio * 100 : 0, sessionStats),
      tonight: computeTonight(window.events, sessionStats),
    };

    let cookedEventPayload: CookedEventPayload | undefined;
    if (summary.status === 'cookd' && resetsAt && resetsAt !== lastCookedEventSentAt) {
      const rlEvent = events.find(e => e.limitResetAt);
      const topModel = Object.entries(summary.modelBreakdown).sort((a, b) => b[1] - a[1])[0]?.[0];
      cookedEventPayload = {
        cookedAt: rlEvent?.ts.toISOString() ?? resetsAt,
        usedTokens: summary.usedTokens,
        limitTokens: summary.limitTokens ?? 0,
        timeToCookMins: summary.tonight?.timeToCookMins,
        topModel,
        resetsAt,
      };
    }

    await syncWindowState(creds!, cookedEventPayload ? { ...summary, cookedEvent: cookedEventPayload } : summary);

    if (cookedEventPayload && resetsAt) {
      lastCookedEventSentAt = resetsAt;
      creds = { ...creds!, lastCookedEventSentAt: resetsAt };
      await saveCredentials(creds);
    }

    lastSyncedPct = newPct;
    lastSyncTime = Date.now();
  }

  // Initial sync on startup — push current state without waiting for a file change
  try {
    await syncNow(initialEvents);
    process.stdout.write(chalk.hex(FAINT)('  synced\n'));
  } catch {
    process.stdout.write(chalk.hex(FAINT)('  initial sync failed\n'));
  }

  const stop = adapter.watch(() => {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(async () => {
      try {
        const events = await adapter.events();
        const calState = loadCalibration();
        const limit = calState?.cpLimit ?? null;
        const window = computeWindow(events, limit);

        const newPct = limit != null ? Math.round(window.ratio * 100) : 0;
        const now = Date.now();
        const hasRLEvent = events.some(e => e.limitResetAt && e.ts.getTime() > now - WINDOW_MS);
        const bigChange = Math.abs(newPct - lastSyncedPct) >= 2;
        const heartbeat = now - lastSyncTime >= 5 * 60 * 1000;
        if (!bigChange && !hasRLEvent && !heartbeat) return;

        await syncNow(events);
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
