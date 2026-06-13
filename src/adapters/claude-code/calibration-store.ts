import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { COOKD_DIR } from '../../auth/credentials.js';
import type { CalibrationConfidence } from './calibrate.js';

const CALIBRATION_FILE = join(COOKD_DIR, 'calibration.json');
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

export interface CalibrationState {
  cpLimit: number | null;
  confidence: CalibrationConfidence;
  calibratedAt: string;
}

export function loadCalibration(): CalibrationState | null {
  try {
    const raw = readFileSync(CALIBRATION_FILE, 'utf8');
    return JSON.parse(raw) as CalibrationState;
  } catch {
    return null;
  }
}

export function saveCalibration(state: CalibrationState): void {
  try {
    mkdirSync(COOKD_DIR, { recursive: true });
    writeFileSync(CALIBRATION_FILE, JSON.stringify(state, null, 2), 'utf8');
  } catch {
    // non-fatal: companion degrades gracefully without persistent state
  }
}

export function isStale(state: CalibrationState): boolean {
  return Date.now() - new Date(state.calibratedAt).getTime() > MAX_AGE_MS;
}
