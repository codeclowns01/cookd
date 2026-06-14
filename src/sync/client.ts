import type { Credentials } from '../auth/credentials.js';
import type { WindowSummary, LifetimeStats, DailyStats } from './events.js';
import { enqueue, peek, ack, incrementAttempts } from './queue.js';

const API_BASE = process.env.COOKD_API_URL ?? 'https://efocqoekmoiecisrmucn.supabase.co';

export async function syncWindowState(creds: Credentials, summary: WindowSummary): Promise<void> {
  enqueue(summary);
  await flushQueue(creds);
}

export async function syncHistoricalStats(creds: Credentials, history: DailyStats[]): Promise<void> {
  const res = await fetch(`${API_BASE}/functions/v1/usage-ingest`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${creds.deviceToken}`,
    },
    body: JSON.stringify({ history }),
  });
  if (!res.ok) throw new Error(`history-sync ${res.status}`);
}

export async function syncLifetimeStats(creds: Credentials, stats: LifetimeStats): Promise<void> {
  const res = await fetch(`${API_BASE}/functions/v1/wrapped-sync`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${creds.deviceToken}`,
    },
    body: JSON.stringify(stats),
  });
  if (!res.ok) throw new Error(`wrapped-sync ${res.status}`);
}

async function flushQueue(creds: Credentials): Promise<void> {
  const batches = peek(10);

  for (const batch of batches) {
    try {
      const res = await fetch(`${API_BASE}/functions/v1/usage-ingest`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${creds.deviceToken}`,
        },
        body: JSON.stringify(batch.payload),
      });

      if (res.ok) {
        ack(batch.id);
      } else {
        incrementAttempts(batch.id);
      }
    } catch {
      incrementAttempts(batch.id);
    }
  }
}
