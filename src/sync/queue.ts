import Database from 'better-sqlite3';
import { join } from 'path';
import { mkdirSync } from 'fs';
import { COOKD_DIR } from '../auth/credentials.js';
import type { WindowSummary } from './events.js';

export interface QueuedBatch {
  id: number;
  payload: WindowSummary;
  createdAt: number;
  attempts: number;
}

let db: Database.Database | null = null;

function getDb(): Database.Database {
  if (db) return db;

  mkdirSync(COOKD_DIR, { recursive: true });
  db = new Database(join(COOKD_DIR, 'local.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');

  // Drop legacy events-based queue; sync_queue uses window summaries
  db.exec('DROP TABLE IF EXISTS queue');

  db.exec(`
    CREATE TABLE IF NOT EXISTS sync_queue (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      payload    TEXT    NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      attempts   INTEGER NOT NULL DEFAULT 0
    )
  `);

  return db;
}

export function enqueue(payload: WindowSummary): void {
  getDb()
    .prepare('INSERT INTO sync_queue (payload) VALUES (?)')
    .run(JSON.stringify(payload));
}

export function peek(limit = 10): QueuedBatch[] {
  return (getDb()
    .prepare('SELECT id, payload, created_at, attempts FROM sync_queue ORDER BY id ASC LIMIT ?')
    .all(limit) as Array<{ id: number; payload: string; created_at: number; attempts: number }>)
    .map(row => ({
      id: row.id,
      payload: JSON.parse(row.payload) as WindowSummary,
      createdAt: row.created_at,
      attempts: row.attempts,
    }));
}

export function ack(id: number): void {
  getDb().prepare('DELETE FROM sync_queue WHERE id = ?').run(id);
}

export function incrementAttempts(id: number): void {
  getDb().prepare('UPDATE sync_queue SET attempts = attempts + 1 WHERE id = ?').run(id);
}

export function queueSize(): number {
  return (getDb().prepare('SELECT COUNT(*) as n FROM sync_queue').get() as { n: number }).n;
}
