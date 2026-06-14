import { homedir } from 'os';
import { join } from 'path';
import { readFile, writeFile, mkdir, chmod } from 'fs/promises';
import { existsSync } from 'fs';

export interface Credentials {
  deviceToken: string;
  handle: string;
  deviceId: string;
  linkedAt: string;
  lastWrappedSync?: string;
  lastCookedEventSentAt?: string;
}

const COOKD_DIR = join(homedir(), '.cookd');
const CREDS_PATH = join(COOKD_DIR, 'credentials.json');

export async function loadCredentials(): Promise<Credentials | null> {
  try {
    const raw = await readFile(CREDS_PATH, 'utf8');
    return JSON.parse(raw) as Credentials;
  } catch {
    return null;
  }
}

export async function saveCredentials(creds: Credentials): Promise<void> {
  await mkdir(COOKD_DIR, { recursive: true });
  await writeFile(CREDS_PATH, JSON.stringify(creds, null, 2), { encoding: 'utf8', mode: 0o600 });
  await chmod(CREDS_PATH, 0o600);
}

export function isLinked(): boolean {
  return existsSync(CREDS_PATH);
}

export { COOKD_DIR };
