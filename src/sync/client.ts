import type { Credentials } from '../auth/credentials.js';
import type { WindowSummary, LifetimeStats, DailyStats } from './events.js';
import { enqueue, peek, ack, incrementAttempts } from './queue.js';

const API_BASE = process.env.COOKD_API_URL ?? 'https://efocqoekmoiecisrmucn.supabase.co';

export async function safeFetch(url: string, options: RequestInit = {}): Promise<Response> {
  try {
    return await fetch(url, options);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/CERT_|certificate|SSL|unable to verify/i.test(msg)) {
      throw new Error(
        'TLS certificate error — your network may be using SSL inspection.\n' +
        'set NODE_EXTRA_CA_CERTS=/path/to/corporate-ca.crt and retry.'
      );
    }
    if (/ECONNREFUSED|ENOTFOUND|ETIMEDOUT|fetch failed/i.test(msg)) {
      const proxy = process.env.HTTPS_PROXY ?? process.env.HTTP_PROXY;
      throw new Error(
        proxy
          ? `cannot reach cookd servers via proxy ${proxy}.\ncheck that HTTPS_PROXY is correct.`
          : 'cannot reach cookd servers — check your connection.\nif behind a proxy, set: HTTPS_PROXY=http://proxy-host:port'
      );
    }
    throw e;
  }
}

/**
 * Why a push failed, if it did (ADR 0009 / design DD2).
 *
 * Reported to the server on the NEXT successful sync so the app's recovery
 * screen can name the actual fault instead of guessing. `token_rejected` is the
 * one worth separating: it never resolves on its own, and the fix (re-link) is
 * different from the fix for a flaky network (wait).
 */
export type PushOutcome = 'ok' | 'token_rejected' | 'network';

export async function syncWindowState(creds: Credentials, summary: WindowSummary): Promise<PushOutcome> {
  enqueue(summary);
  return flushQueue(creds);
}

export async function syncHistoricalStats(creds: Credentials, history: DailyStats[]): Promise<void> {
  const res = await safeFetch(`${API_BASE}/functions/v1/usage-ingest`, {
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
  const res = await safeFetch(`${API_BASE}/functions/v1/wrapped-sync`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${creds.deviceToken}`,
    },
    body: JSON.stringify(stats),
  });
  if (!res.ok) throw new Error(`wrapped-sync ${res.status}`);
}

async function flushQueue(creds: Credentials): Promise<PushOutcome> {
  const batches = peek(10);
  // The worst outcome across the batch wins: one accepted payload does not mean
  // the device is healthy if another was refused. Delivery behaviour is
  // unchanged — this only observes it.
  let outcome: PushOutcome = 'ok';

  for (const batch of batches) {
    try {
      const res = await safeFetch(`${API_BASE}/functions/v1/usage-ingest`, {
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
        // 401 is the only status that means "this device's credentials are
        // dead". Everything else — 4xx from a malformed payload, 5xx from the
        // server — is transient from the device's point of view and retries.
        if (res.status === 401) outcome = 'token_rejected';
        else if (outcome === 'ok') outcome = 'network';
      }
    } catch {
      incrementAttempts(batch.id);
      if (outcome === 'ok') outcome = 'network';
    }
  }

  return outcome;
}
