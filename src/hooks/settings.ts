import { homedir } from 'os';
import { join } from 'path';
import { readFileSync, writeFileSync, copyFileSync, existsSync, renameSync, mkdirSync } from 'fs';

export class SettingsError extends Error {}

export function claudeSettingsPath(): string {
  return join(homedir(), '.claude', 'settings.json');
}

interface HookEntry { type: string; command: string; args?: string[]; async?: boolean; timeout?: number; }
interface HookGroup { matcher?: string; hooks: HookEntry[]; }
interface Settings { hooks?: Record<string, HookGroup[]>; [k: string]: unknown; }

// cookd installs into both lifecycle events: SessionStart re-extends access when a
// session begins (and flushes any queue a killed SessionEnd sync left behind);
// SessionEnd captures the final delta of the session that just ended.
const COOKD_EVENTS = ['SessionStart', 'SessionEnd'] as const;

function read(path: string): Settings {
  if (!existsSync(path)) return {};
  const raw = readFileSync(path, 'utf8').trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Settings;
  } catch {
    throw new SettingsError(
      '~/.claude/settings.json is not valid JSON — refusing to modify it. Fix or remove it and retry.',
    );
  }
}

function writeAtomic(path: string, settings: Settings): void {
  mkdirSync(join(path, '..'), { recursive: true });
  const tmp = `${path}.cookd-tmp`;
  writeFileSync(tmp, JSON.stringify(settings, null, 2) + '\n', 'utf8');
  renameSync(tmp, path);
}

/** Identify our hook by its command path, not a custom marker field (which Claude
 *  Code could strip on its own rewrite). */
function isCookdHook(h: HookEntry): boolean {
  return typeof h.command === 'string' && h.command.replace(/\\/g, '/').includes('.cookd/bin/cookd');
}

/** Exec form (args array) — no shell, so a binary path containing spaces is safe on Windows. */
function cookdEntry(binaryPath: string): HookEntry {
  return { type: 'command', command: binaryPath, args: ['sync'], async: true, timeout: 30 };
}

export function hasCookdHook(path: string): boolean {
  const s = read(path);
  return COOKD_EVENTS.some(ev => (s.hooks?.[ev] ?? []).some(g => g.hooks.some(isCookdHook)));
}

/** Install cookd into BOTH SessionStart and SessionEnd. Idempotent, backed up, atomic. */
export function installCookdHooks(path: string, binaryPath: string): void {
  const s = read(path); // throws SettingsError if unparseable — before any write
  if (existsSync(path)) copyFileSync(path, `${path}.cookd-bak`);
  s.hooks ??= {};
  for (const ev of COOKD_EVENTS) {
    s.hooks[ev] ??= [];
    // strip any prior cookd entries first (idempotent), then add exactly one
    for (const g of s.hooks[ev]) g.hooks = g.hooks.filter(h => !isCookdHook(h));
    s.hooks[ev] = s.hooks[ev].filter(g => g.hooks.length > 0);
    s.hooks[ev].push({ hooks: [cookdEntry(binaryPath)] });
  }
  writeAtomic(path, s);
}

export function removeCookdHook(path: string): void {
  if (!existsSync(path)) return;
  const s = read(path);
  if (!s.hooks) return;
  for (const ev of COOKD_EVENTS) {
    if (!s.hooks[ev]) continue;
    for (const g of s.hooks[ev]) g.hooks = g.hooks.filter(h => !isCookdHook(h));
    s.hooks[ev] = s.hooks[ev].filter(g => g.hooks.length > 0);
    if (s.hooks[ev].length === 0) delete s.hooks[ev];
  }
  writeAtomic(path, s);
}
