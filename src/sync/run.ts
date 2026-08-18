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
import { readHealth, type PushFailure } from './health.js';
import {
  loadSyncState, saveSyncState, scanSignature, signaturesEqual,
  shouldPush, recordScanMs,
} from './gate.js';

function deriveStatus(ratio: number, limit: number | null): SessionStatus {
  if (!limit || ratio < 0.1) return 'idle';
  if (ratio >= 0.95) return 'cookd';
  return 'cooking';
}

/**
 * Why a sync did what it did (ADR-012 decision 4 / eng-review delta E1).
 *
 * This used to be `{ synced: boolean }`, and that boolean meant four unrelated
 * things: no agent installed, nothing changed since the last push, the growth
 * gate declined, or the server refused us. `init` therefore printed "synced."
 * over a 401 — and, once the ADR-011 hooks made the stat gate the common path,
 * printed it after making no network call at all. A caller cannot tell the user
 * the truth about a signal that was thrown away at the boundary.
 */
export type SyncOutcome =
  | 'no_adapter'      // no supported agent on this machine
  | 'unchanged'       // stat-only signature identical to the last push (gate 1)
  | 'gated'           // real growth below the push threshold (gate 2)
  | 'ok'              // the server accepted it — the ONLY proof the token is alive
  | 'token_rejected'  // 401: these credentials are dead
  | 'network';        // could not reach the server — proves nothing either way

export interface SyncResult { outcome: SyncOutcome; creds: Credentials; }

export interface SyncOptions {
  /**
   * Skip both gates and push unconditionally.
   *
   * `init` — and only `init` — passes this. A recovery attempt has to *prove*
   * the token is alive or dead, and both gates return before any HTTP, so a
   * gated run learns nothing. Hooks keep the gates, which preserves ADR-011's
   * TG1 invariant that an idle machine costs exactly zero: the bypass runs at
   * human-initiated `init` frequency, never at `Stop` frequency.
   */
  force?: boolean;
}

/**
 * One-shot sync: read current usage, build the WindowSummary, push it via the queue.
 * Stateless — used by both the watch loop and the headless `cookd sync` command.
 * Persists an updated cooked-event marker onto creds when a fresh cook is sent.
 */
export async function runSyncOnce(creds: Credentials, opts: SyncOptions = {}): Promise<SyncResult> {
  const adapter = await detectAdapter();
  if (!adapter) return { outcome: 'no_adapter', creds };

  // Gate 1 — stat only, no file contents read. An idle machine costs exactly
  // zero: no scan, no network, no background work (TG1). `Stop` fires every
  // turn, so without this the scan cost would follow turn count rather than
  // actual usage.
  let state = loadSyncState();
  const signature = await scanSignature();
  if (!opts.force && state.lastPushedAt && signaturesEqual(signature, state.signature)) {
    return { outcome: 'unchanged', creds };
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
  if (!opts.force && !shouldPush(window.weightedTokens, limit, state.lastPushedWeighted)) {
    saveSyncState(state);
    return { outcome: 'gated', creds };
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
    // Self-report (design DD2). Deliberately carries the PREVIOUS run's failure:
    // a companion that could not reach the server could not have told it so at
    // the time, so the report necessarily rides the next push that gets through.
    ...readHealth((state.lastError ?? null) as PushFailure | null),
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

  const outcome = await syncWindowState(creds, cookedEvent ? { ...summary, cookedEvent } : summary);

  if (cookedEvent && resetsAt) {
    out = { ...creds, lastCookedEventSentAt: resetsAt };
    await saveCredentials(out);
  }

  // Only recorded after the push path returns. On a network failure the payload
  // is queued and the push markers stay unchanged, so the next hook fire
  // re-evaluates the growth gate against the last state the server actually
  // accepted — and carries the failure code forward until a push can report it.
  const failed = outcome !== 'ok';
  saveSyncState({
    ...state,
    lastError: failed ? outcome : null,
    ...(failed ? {} : {
      lastPushedWeighted: window.weightedTokens,
      lastPushedAt: new Date().toISOString(),
    }),
  });

  // `outcome` is the server's verdict, passed through verbatim. On a forced run
  // this is what proves the token alive ('ok') or dead ('token_rejected');
  // 'network' proves neither and callers must not treat it as either.
  return { outcome, creds: out };
}
