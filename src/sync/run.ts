import { detectAdapter } from '../adapters/registry.js';
import { ClaudeCodeAdapter } from '../adapters/claude-code/index.js';
import { computeWindow, WINDOW_MS } from '../adapters/claude-code/window.js';
import { calibrate, extractLatestResetTime } from '../adapters/claude-code/calibrate.js';
import { computeModelBreakdown, computeDailyStats, computeTonight } from '../adapters/claude-code/wrapped.js';
import { loadCalibration, saveCalibration, isStale } from '../adapters/claude-code/calibration-store.js';
import { syncWindowState } from './client.js';
import type { WindowSummary, SessionStatus, CookedEventPayload } from './events.js';
import { saveCredentials, type Credentials } from '../auth/credentials.js';

function deriveStatus(ratio: number, limit: number | null): SessionStatus {
  if (!limit || ratio < 0.1) return 'idle';
  if (ratio >= 0.95) return 'cookd';
  return 'cooking';
}

export interface SyncResult { synced: boolean; creds: Credentials; }

/**
 * One-shot sync: read current usage, build the WindowSummary, push it via the queue.
 * Stateless — used by both the watch loop and the headless `cookd sync` command.
 * Persists an updated cooked-event marker onto creds when a fresh cook is sent.
 */
export async function runSyncOnce(creds: Credentials): Promise<SyncResult> {
  const adapter = await detectAdapter();
  if (!adapter) return { synced: false, creds };

  const ccAdapter = adapter instanceof ClaudeCodeAdapter ? adapter : null;
  const events = await adapter.events();

  let cal = loadCalibration();
  if (!cal || isStale(cal)) {
    const r = calibrate(events);
    cal = { cpLimit: r.cpLimit, confidence: r.confidence, calibratedAt: new Date().toISOString() };
    saveCalibration(cal);
  }
  const limit = cal?.cpLimit ?? null;
  const window = computeWindow(events, limit);

  const resetFromError = extractLatestResetTime(events);
  const oldest = window.events[0];
  const resetsAt = resetFromError?.toISOString()
    ?? (oldest ? new Date(oldest.ts.getTime() + WINDOW_MS).toISOString() : null);

  const sessionStats = ccAdapter?.getSessionStats() ?? { prompts: 0, yoloPrompts: 0, toolCounts: {}, toolErrors: 0 };
  const today = new Date().toLocaleDateString('en-CA');

  const summary: WindowSummary = {
    status: deriveStatus(window.ratio, limit),
    usedTokens: window.weightedTokens,
    limitTokens: limit,
    pctUsed: limit != null ? window.ratio * 100 : null,
    windowStart: window.windowStart.toISOString(),
    resetsAt,
    plan: null,
    calibrationConfidence: cal?.confidence ?? 'none',
    modelBreakdown: Object.fromEntries(computeModelBreakdown(window.events).map(s => [s.model, s.cpTokens])),
    dailyStats: computeDailyStats(events, today, limit != null ? window.ratio * 100 : 0, sessionStats),
    tonight: computeTonight(window.events, sessionStats),
  };

  let out = creds;
  let cookedEvent: CookedEventPayload | undefined;
  if (summary.status === 'cookd' && resetsAt && resetsAt !== creds.lastCookedEventSentAt) {
    const rlEvent = events.find(e => e.limitResetAt);
    const topModel = Object.entries(summary.modelBreakdown).sort((a, b) => b[1] - a[1])[0]?.[0];
    cookedEvent = {
      cookedAt: rlEvent?.ts.toISOString() ?? resetsAt,
      usedTokens: summary.usedTokens,
      limitTokens: summary.limitTokens ?? 0,
      timeToCookMins: summary.tonight?.timeToCookMins,
      topModel,
      resetsAt,
    };
  }

  await syncWindowState(creds, cookedEvent ? { ...summary, cookedEvent } : summary);

  if (cookedEvent && resetsAt) {
    out = { ...creds, lastCookedEventSentAt: resetsAt };
    await saveCredentials(out);
  }
  return { synced: true, creds: out };
}
