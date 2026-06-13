import { randomBytes } from 'crypto';
import type { Credentials } from './credentials.js';

const API_BASE = process.env.COOKD_API_URL ?? '';

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

export async function pollForLink(
  deviceId: string,
  sessionId: string,
  onPoll: () => void,
  existingDeviceToken?: string,
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
      const token = status.deviceToken ?? existingDeviceToken;
      if (!token) return null;
      return {
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
