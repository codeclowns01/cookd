import { describe, it, expect } from 'vitest';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { installCookdHooks, removeCookdHook, hasCookdHook, SettingsError } from '../../src/hooks/settings.js';

const BIN = '/home/u/.cookd/bin/cookd';

function tmpSettings(initial?: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'cookd-settings-'));
  const p = join(dir, 'settings.json');
  if (initial !== undefined) writeFileSync(p, initial);
  return p;
}

function cookdEntries(settings: any, event: string): any[] {
  return (settings.hooks?.[event] ?? []).flatMap((g: any) => g.hooks)
    .filter((h: any) => typeof h.command === 'string' && h.command.includes('.cookd/bin/cookd'));
}

describe('settings.json hook management', () => {
  it('installs cookd into SessionStart, SessionEnd AND Stop, in exec form', () => {
    const p = tmpSettings();
    installCookdHooks(p, BIN);
    const s = JSON.parse(readFileSync(p, 'utf8'));
    for (const ev of ['SessionStart', 'SessionEnd', 'Stop']) {
      const entries = cookdEntries(s, ev);
      expect(entries).toHaveLength(1);
      expect(entries[0].command).toBe(BIN);
      expect(entries[0].args).toEqual(['sync']); // exec form — no shell string
      expect(entries[0]._cookd).toBeUndefined(); // no marker field
    }
    expect(hasCookdHook(p)).toBe(true);
  });

  it('preserves existing unrelated settings and hooks (merge, not overwrite)', () => {
    const p = tmpSettings(JSON.stringify({
      theme: 'dark',
      hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo hi' }] }] },
    }, null, 2));
    installCookdHooks(p, BIN);
    const s = JSON.parse(readFileSync(p, 'utf8'));
    expect(s.theme).toBe('dark');
    expect(s.hooks.PreToolUse).toHaveLength(1);
    expect(cookdEntries(s, 'SessionEnd')).toHaveLength(1);
  });

  it('writes a backup before modifying', () => {
    const p = tmpSettings(JSON.stringify({ theme: 'dark' }));
    installCookdHooks(p, BIN);
    expect(existsSync(`${p}.cookd-bak`)).toBe(true);
  });

  it('is idempotent — no duplicate cookd hook on re-install', () => {
    const p = tmpSettings();
    installCookdHooks(p, BIN);
    installCookdHooks(p, BIN);
    const s = JSON.parse(readFileSync(p, 'utf8'));
    expect(cookdEntries(s, 'SessionStart')).toHaveLength(1);
    expect(cookdEntries(s, 'SessionEnd')).toHaveLength(1);
  });

  it('removeCookdHook removes cookd from both events, leaving other hooks intact', () => {
    const p = tmpSettings(JSON.stringify({
      hooks: { SessionEnd: [{ hooks: [{ type: 'command', command: 'other' }] }] },
    }));
    installCookdHooks(p, BIN);
    removeCookdHook(p);
    const s = JSON.parse(readFileSync(p, 'utf8'));
    expect(hasCookdHook(p)).toBe(false);
    const cmds = (s.hooks.SessionEnd ?? []).flatMap((g: any) => g.hooks).map((h: any) => h.command);
    expect(cmds).toContain('other');
  });

  it('removes cookd even when Claude stripped a hypothetical marker (identity is by command path)', () => {
    const p = tmpSettings();
    installCookdHooks(p, BIN);
    removeCookdHook(p);
    expect(hasCookdHook(p)).toBe(false);
  });

  it('aborts on an unparseable existing file (never blind-overwrites)', () => {
    const p = tmpSettings('{ this is not json');
    expect(() => installCookdHooks(p, BIN)).toThrow(SettingsError);
  });

  it('registers Stop, the per-turn trigger that keeps usage current mid-session (ADR 0009)', () => {
    const p = tmpSettings();
    installCookdHooks(p, BIN);
    const s = JSON.parse(readFileSync(p, 'utf8'));
    expect(cookdEntries(s, 'Stop')).toHaveLength(1);
    // Exec form must survive: Claude Code v2.1.220 ships `args` and `async`, and
    // collapsing this into a shell string breaks on Windows paths with spaces.
    const entry = cookdEntries(s, 'Stop')[0];
    expect(entry.args).toEqual(['sync']);
    expect(entry.async).toBe(true);
  });

  it('removeCookdHook clears Stop as well, leaving no orphan', () => {
    const p = tmpSettings();
    installCookdHooks(p, BIN);
    removeCookdHook(p);
    const s = JSON.parse(readFileSync(p, 'utf8'));
    expect(s.hooks?.Stop ?? []).toEqual([]);
  });
});
