import { randomBytes } from 'crypto';
import type { Credentials } from './credentials.js';

const API_BASE = process.env.COOKD_API_URL ?? 'https://efocqoekmoiecisrmucn.supabase.co';

export interface DeviceLinkStartResponse {
  pressCode: string;
  sessionId: string;
  expiresAt: string;
}

interface DeviceLinkStatusResponse {
  status: 'pending' | 'linked' | 'expired';
  deviceToken?: string;
  handle?: string;
}

export async function deviceLinkStart(deviceId: string, deviceToken?: string): Promise<DeviceLinkStartResponse> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (deviceToken) headers['Authorization'] = `Bearer ${deviceToken}`;
  const res = await fetch(`${API_BASE}/functions/v1/device-link-start`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ deviceId }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`device-link-start failed: ${res.status} ${body}`);
  }

  return res.json() as Promise<DeviceLinkStartResponse>;
}

async function deviceLinkStatus(sessionId: string): Promise<DeviceLinkStatusResponse> {
  const res = await fetch(`${API_BASE}/functions/v1/device-link-status`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`device-link-status failed: ${res.status} ${body}`);
  }

  return res.json() as Promise<DeviceLinkStatusResponse>;
}

export function generateDeviceId(): string {
  return randomBytes(16).toString('hex');
}

/**
 * @param existing  The credentials this machine already holds, if any. Passed
 *   WHOLE rather than as a bare token: `Credentials` carries two sync watermarks
 *   (`lastWrappedSync`, `lastCookedEventSentAt`) beyond the four fields a link
 *   produces, and rebuilding the object from scratch silently dropped them. That
 *   was unreachable while an already-linked device could never reach this
 *   function; ADR-012 removes that guard, so a recovery relink would otherwise
 *   reset `lastWrappedSync` and make `watch.ts` re-push the entire lifetime
 *   history through the direct-POST bypass.
 * @param timeoutMs How long to wait for redemption. `init` passes a SHORT leash
 *   on the relink path — a returning user is staring at their own terminal and
 *   must not be held for ten minutes (and a non-TTY run must not block at all).
 */
export async function pollForLink(
  deviceId: string,
  sessionId: string,
  onPoll: () => void,
  existing?: Credentials | null,
  intervalMs = 3000,
  timeoutMs = 10 * 60 * 1000,
): Promise<Credentials | null> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, intervalMs));
    onPoll();

    const status = await deviceLinkStatus(sessionId);

    if (status.status === 'linked' && status.handle) {
      // Reauth: no new device token returned; keep existing one
      const token = status.deviceToken ?? existing?.deviceToken;
      if (!token) return null;
      // Spread first: preserve the sync watermarks this handshake knows nothing
      // about, then overwrite exactly the four fields a link actually produces.
      return {
        ...existing,
        deviceToken: token,
        handle: status.handle,
        deviceId,
        linkedAt: new Date().toISOString(),
      };
    }

    if (status.status === 'expired') return null;
  }

  return null;
}
