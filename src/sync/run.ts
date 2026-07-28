import { detectAdapter } from '../adapters/registry.js';
import { ClaudeCodeAdapter } from '../adapters/claude-code/index.js';
import { computeWindow, WINDOW_MS } from '../adapters/claude-code/window.js';
import { calibrate, extractLatestResetTime } from '../adapters/claude-code/calibrate.js';
import { computeModelBreakdown, computeDailyStats, computeTonight } from '../adapters/claude-code/wrapped.js';
import { loadCalibration, saveCalibration, isStale } from '../adapters/claude-code/calibration-store.js';
import { syncWindowState } from './client.js';
import type { WindowSummary, SessionStatus, CookedEventPayload } from './events.js';
import { saveCredentials, type Credentials } from '../auth/credentials.js';
import { bucketsInWindow } from './buckets.js';
import {
  loadSyncState, saveSyncState, scanSignature, signaturesEqual,
  shouldPush, recordScanMs,
} from './gate.js';

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

  // Gate 1 — stat only, no file contents read. An idle machine costs exactly
  // zero: no scan, no network, no background work (TG1). `Stop` fires every
  // turn, so without this the scan cost would follow turn count rather than
  // actual usage.
  let state = loadSyncState();
  const signature = await scanSignature();
  if (state.lastPushedAt && signaturesEqual(signature, state.signature)) {
    return { synced: false, creds };
  }

  const ccAdapter = adapter instanceof ClaudeCodeAdapter ? adapter : null;
  const scanStartedAt = Date.now();
  const events = await adapter.events();
  state = recordScanMs({ ...state, signature }, Date.now() - scanStartedAt);

  let cal = loadCalibration();
  if (!cal || isStale(cal)) {
    const r = calibrate(events);
    cal = { cpLimit: r.cpLimit, confidence: r.confidence, calibratedAt: new Date().toISOString() };
    saveCalibration(cal);
  }
  const limit = cal?.cpLimit ?? null;
  const window = computeWindow(events, limit);

  // Gate 2 — push on *growth*, not elapsed time (journal D4). This bounds how
  // wrong the displayed number can be rather than how old it is, which is what
  // makes a 10-day session behave the same as a 10-minute one.
  if (!shouldPush(window.weightedTokens, limit, state.lastPushedWeighted)) {
    saveSyncState(state);
    return { synced: false, creds };
  }

  const resetFromError = extractLatestResetTime(events);
  const oldest = window.events[0];
  const resetsAt = resetFromError?.toISOString()
    ?? (oldest ? new Date(oldest.ts.getTime() + WINDOW_MS).toISOString() : null);

  const sessionStats = ccAdapter?.getSessionStats() ?? { prompts: 0, yoloPrompts: 0, toolCounts: {}, toolErrors: 0 };
  const today = new Date().toLocaleDateString('en-CA');

  const summary: WindowSummary = {
    // `events` is already de-duplicated by message.id — ClaudeCodeAdapter.events()
    // runs deduplicateEvents() before returning. That ordering is mandatory and
    // may never be removed (journal D11): bucketing discards message.id, so a
    // duplicate folded into a bucket can never be recovered.
    buckets: bucketsInWindow(events),
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

  // Only recorded after the push path returns. On a network failure the payload
  // is queued and this stays unchanged, so the next hook fire re-evaluates the
  // growth gate against the last state the server actually accepted.
  saveSyncState({
    ...state,
    lastPushedWeighted: window.weightedTokens,
    lastPushedAt: new Date().toISOString(),
  });

  return { synced: true, creds: out };
}
