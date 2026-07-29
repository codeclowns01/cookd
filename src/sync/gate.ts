import { stat } from 'fs/promises';
import { join } from 'path';
import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'fs';
import { COOKD_DIR } from '../auth/credentials.js';
import { claudeProjectsRoot, discoverProjectDirs, jsonlFilesIn } from '../adapters/claude-code/paths.js';

/**
 * Cheap fingerprint of the transcript tree, from `stat` only.
 *
 * This is a **gating cursor, not an offset cursor**. It decides *whether* to
 * scan; it never changes *what* gets read. That distinction is load-bearing:
 * `message.id` de-duplication (journal D11) and ADR-005's gap-based calibration
 * both need whole-corpus visibility, and an offset cursor would remove it. An
 * offset cursor would also change which duplicate variant `shouldReplaceDedup`
 * picks, so partial scans could rewrite correct history with wrong totals.
 */
export interface ScanSignature {
  fileCount: number;
  totalSize: number;
  maxMtimeMs: number;
}

export interface SyncState {
  /** Signature at the last time we scanned. */
  signature?: ScanSignature;
  /** Weighted token total of the window at the last successful push. */
  lastPushedWeighted?: number;
  /** ISO instant of the last successful push. */
  lastPushedAt?: string;
  /** Rolling record of scan wall-time, so the ADR's "revisit the cursor at
   *  p95 > 5s" trigger has something to fire on. Most recent last. */
  scanMs?: number[];
  /** Why the LAST push failed, carried until a push succeeds and can report it
   *  (ADR 0009 / design DD2). Null once reported. */
  lastError?: string | null;
}

const STATE_PATH = () => join(COOKD_DIR, 'sync-state.json');
const SCAN_SAMPLES = 50;

export function loadSyncState(): SyncState {
  try {
    return JSON.parse(readFileSync(STATE_PATH(), 'utf8')) as SyncState;
  } catch {
    return {};
  }
}

export function saveSyncState(s: SyncState): void {
  mkdirSync(COOKD_DIR, { recursive: true });
  const tmp = `${STATE_PATH()}.tmp`;
  writeFileSync(tmp, JSON.stringify(s, null, 2), 'utf8');
  renameSync(tmp, STATE_PATH());
}

/** Walk the transcript tree with `stat` only — no file contents are read. */
export async function scanSignature(): Promise<ScanSignature> {
  const sig: ScanSignature = { fileCount: 0, totalSize: 0, maxMtimeMs: 0 };
  const dirs = await discoverProjectDirs();
  for (const dir of dirs) {
    for (const { path } of await jsonlFilesIn(dir)) {
      try {
        const st = await stat(path);
        sig.fileCount += 1;
        sig.totalSize += st.size;
        if (st.mtimeMs > sig.maxMtimeMs) sig.maxMtimeMs = st.mtimeMs;
      } catch {
        // A transcript deleted mid-walk simply does not count.
      }
    }
  }
  return sig;
}

export function signaturesEqual(a?: ScanSignature, b?: ScanSignature): boolean {
  if (!a || !b) return false;
  return a.fileCount === b.fileCount && a.totalSize === b.totalSize && a.maxMtimeMs === b.maxMtimeMs;
}

/**
 * Fraction of the limit the window must grow by before a push is worth it
 * (journal D4). Gating on *growth* rather than *elapsed time* bounds the
 * displayed inaccuracy instead of the staleness, which is what makes a 10-day
 * session behave identically to a 10-minute one.
 */
export const GROWTH_THRESHOLD = 0.05;

/**
 * Whether the window has moved enough to justify a network write.
 *
 * With no calibrated limit there is no meaningful denominator, so any growth at
 * all pushes — being wrong about the limit must not mean never reporting usage.
 * A drop pushes too: the window is rolling, so usage falling out of it is real
 * information, and withholding it would leave the server over-reporting.
 */
export function shouldPush(
  currentWeighted: number,
  limit: number | null | undefined,
  lastPushedWeighted?: number,
): boolean {
  if (lastPushedWeighted === undefined) return true;
  const delta = Math.abs(currentWeighted - lastPushedWeighted);
  if (delta === 0) return false;
  if (!limit || limit <= 0) return true;
  return delta >= limit * GROWTH_THRESHOLD;
}

/** Record a scan duration, keeping the most recent `SCAN_SAMPLES`. */
export function recordScanMs(state: SyncState, ms: number): SyncState {
  const samples = [...(state.scanMs ?? []), Math.round(ms)].slice(-SCAN_SAMPLES);
  return { ...state, scanMs: samples };
}

/** p95 scan wall-time, or null with too few samples. ADR 0009 names p95 > 5s as
 *  the trigger to revisit the incremental-cursor decision. */
export function p95ScanMs(state: SyncState): number | null {
  const s = [...(state.scanMs ?? [])].sort((a, b) => a - b);
  if (s.length < 5) return null;
  return s[Math.min(s.length - 1, Math.ceil(s.length * 0.95) - 1)];
}

export { claudeProjectsRoot };
