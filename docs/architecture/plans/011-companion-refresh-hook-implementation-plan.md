# Companion Auto-Refresh (SessionEnd Hook) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the companion keep the app's "last sync" (and the user's `access_expires_at`) fresh automatically by running a headless sync at the end of every Claude Code session — installed on consent as a `SessionEnd` hook that calls a pinned, downloaded local binary.

**Architecture:** Companion-side only (no backend, no app change). A new headless `cookd sync` reuses the existing full-tree scan and the existing `syncWindowState` queue path. On consent during signup, cookd downloads the one os/arch-matched binary from the release host (checksum-verified) to `~/.cookd/bin/cookd`, then writes a `SessionEnd` hook into `~/.claude/settings.json` (backup + add-only merge + atomic write). `cookd uninstall` reverses both. Re-running the signup command on an already-linked device syncs silently (no press code).

**Tech Stack:** TypeScript/Node ESM, commander, Ink (React) UI, better-sqlite3 (WAL) queue, Vitest. Binaries produced by `bun compile` in `.github/workflows/release.yml`.

**Source of truth:** ADR-011 (`docs/architecture/decisions/011-companion-refresh-hook.md`) — this plan implements its Acceptance Criteria. See also `docs/architecture/CODEBASE-ARCHITECTURE.md`.

---

## Eng-review revisions (2026-07-20) — these SUPERSEDE conflicting inline task code below

Four decisions from `/plan-eng-review`. Where the inline tasks disagree, follow these.

**D1 — Hooks use the exec form, not a shell string (fixes a Windows ship-blocker).** A shell-string command `${binaryPath} sync` breaks on Windows home paths with spaces (`C:\Users\First Last\…`) — the hook silently never fires. Use Claude Code's exec form: `command: binaryPath, args: ['sync']`. No shell, no quoting, matches ADR-011's execFile/arg-array convention.

**D2 — Identify cookd's hook by command path, not a `_cookd` marker.** Drop the non-standard `_cookd: true` field (Claude Code may strip unknown fields on its own rewrite, orphaning uninstall). Match entries whose `command` points at our binary (`.cookd/bin/cookd`).

**D3 — Install BOTH `SessionStart` and `SessionEnd` hooks.** SessionStart runs the same `cookd sync`; it re-extends `access_expires_at` the moment the user starts coding (closes carried risk R1) and flushes any queue left by an async SessionEnd sync that Claude killed on exit. `cookd uninstall` removes both.

**D4 — Release-coupling is documented + degrades gracefully.** `downloadBinary` fetches `SHA256SUMS` from the `v${version}` release, which only exists from the release that ships Task 11 forward. So auto-sync is live only from that version on; older versions' consent attempts fail the checksum fetch → Task 10 catches → "auto-sync setup skipped, re-run later." Note this in README.

### D1+D2+D3 — corrected `src/hooks/settings.ts` (replaces Task 6 Step 3 impl)
```typescript
import { homedir } from 'os';
import { join } from 'path';
import { readFileSync, writeFileSync, copyFileSync, existsSync, renameSync, mkdirSync } from 'fs';

export class SettingsError extends Error {}
export function claudeSettingsPath(): string { return join(homedir(), '.claude', 'settings.json'); }

interface HookEntry { type: string; command: string; args?: string[]; async?: boolean; timeout?: number; }
interface HookGroup { matcher?: string; hooks: HookEntry[]; }
interface Settings { hooks?: Record<string, HookGroup[]>; [k: string]: unknown; }

const COOKD_EVENTS = ['SessionStart', 'SessionEnd'] as const;

function read(path: string): Settings {
  if (!existsSync(path)) return {};
  const raw = readFileSync(path, 'utf8').trim();
  if (!raw) return {};
  try { return JSON.parse(raw) as Settings; }
  catch { throw new SettingsError('~/.claude/settings.json is not valid JSON — refusing to modify it.'); }
}
function writeAtomic(path: string, settings: Settings): void {
  mkdirSync(join(path, '..'), { recursive: true });
  const tmp = `${path}.cookd-tmp`;
  writeFileSync(tmp, JSON.stringify(settings, null, 2) + '\n', 'utf8');
  renameSync(tmp, path);
}
/** D2: identify our hook by command path, not a marker field. */
function isCookdHook(h: HookEntry): boolean {
  return typeof h.command === 'string' && h.command.replace(/\\/g, '/').includes('.cookd/bin/cookd');
}
/** D1: exec form — args array, no shell, safe with spaces in the path. */
function cookdEntry(binaryPath: string): HookEntry {
  return { type: 'command', command: binaryPath, args: ['sync'], async: true, timeout: 30 };
}

export function hasCookdHook(path: string): boolean {
  const s = read(path);
  return COOKD_EVENTS.some(ev => (s.hooks?.[ev] ?? []).some(g => g.hooks.some(isCookdHook)));
}
/** D3: install cookd into BOTH SessionStart and SessionEnd. Idempotent, backed up, atomic. */
export function installCookdHooks(path: string, binaryPath: string): void {
  const s = read(path); // throws SettingsError before any write
  if (existsSync(path)) copyFileSync(path, `${path}.cookd-bak`);
  s.hooks ??= {};
  for (const ev of COOKD_EVENTS) {
    s.hooks[ev] ??= [];
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
```
Task 7's `install.ts` calls `installCookdHooks(...)` (renamed from `installSessionEndHook`). Task 6 tests must add: exec-form assertion (`entry.args` = `['sync']`, no `_cookd`), a SessionStart-entry assertion, and identity-by-command-path for removal.

### Added test requirements (Test review)
- **Regression (CRITICAL):** Task 1 refactors `watch.ts`, which has no test. Add `test/sync/run.test.ts` equivalence coverage (done) AND a manual verification step in Task 12: run `node dist/cli.js watch`, touch a transcript, confirm a sync still fires (`.` printed). Automated watch testing (chokidar+timers) is out of scope for this repo's harness.
- **Non-interactive guard:** add a test that `runInitPlain` with `process.stdin.isTTY = false` does NOT call `installAutoSync`.
- **Both-hooks:** Task 6 test asserts `hasCookdHook` true after install and that BOTH `SessionStart` and `SessionEnd` carry a cookd entry; `removeCookdHook` clears both.

---

## Design-review revisions (2026-07-21) — Task 10 consent + Task 8 uninstall UI

Consent/uninstall UI reviewed (6/10 → 9/10). Terminal Ink UI, reuses `ui/theme.ts` + `ui/ink/*`. Four deltas — DD1/DD2 supersede Task 10's `consentLines`/`Consent`; DD3/DD4 update the wiring/uninstall copy.

**DD1 — The consent must show the REAL edit (was trust-critical wrong).** After the eng-review deltas the screen wrote two hooks in exec form, but `consentLines` still showed a single old-form `SessionEnd` line — the transparency contract was broken. Rewrite to a **faithful plain-language summary** naming BOTH events + the exact command, and disclose the **~50–90 MB one-time download**:
```typescript
export function consentLines(binaryPath: string): string[] {
  return [
    'keep your stats fresh automatically?',
    '',
    'cookd will add two hooks to  ~/.claude/settings.json :',
    `  · on Claude session START  ->  ${binaryPath} sync`,
    `  · on Claude session END    ->  ${binaryPath} sync`,
    '  (runs in the background, 30s cap; open the file for the exact JSON)',
    '',
    'what it does:  syncs your usage when a Claude session starts or ends.',
    'what it reads: only that session’s usage numbers.',
    'what it never: touches your prompts, code, or files.',
    '',
    'first run downloads a ~60MB helper to ~/.cookd/bin (one time).',
    'we back up your settings first and only add - never overwrite.',
    'remove anytime:  cookd uninstall',
  ];
}
```
Updated `consent-copy.test.ts` asserts: contains `~/.claude/settings.json`; names BOTH `START` and `END`; contains `${binaryPath}` + `sync`; discloses the download (`~60MB` / `download`); states it never touches prompts/code; contains `cookd uninstall`.

**DD2 — Make the edit the most legible element (it's the trust anchor).** In `Consent.tsx`, render the two `· on Claude session …` command lines in `STAMP`/`MUT` (not `FAINT`) so the thing the user consents to reads at a glance; keep the surrounding prose in `FAINT`. Frame it with the existing `BoxDivider`/`BoxBlank` chrome as its own set-apart block (same visual weight pattern as `PressCode`). No new visual style.

**DD3 — Humane deferred/error copy.** Task 10's catch must not surface raw errors. Map to human copy: offline/download failure → `"couldn't reach the download server - auto-sync will finish next time you run cookd"`; managed-policy block → `"your organization blocks Claude hooks - auto-sync unavailable here"`; anything else → `"auto-sync setup skipped - re-run cookd anytime to finish"`. Keep the raw error only in a `--verbose`/debug path.

**DD4 — Uninstall copy (Task 8).** `runUninstall` output: `"the auto-sync hooks and local binary are gone. your account is untouched."` (plural "hooks" — both events). Confirm-line default stays `[Y/n]` (default yes) per the design decision.

Confirm prompt default: **`[Y/n]` (default yes)** — disclosure is now complete (exact edit shown, download disclosed), so bare-Enter-installs is the low-friction, honest happy path.

---

## File Structure

**New files:**
- `src/sync/run.ts` — `runSyncOnce(creds)`: the shared headless sync (extracted from `watch.ts`'s inline `syncNow`). Both `watch` and `cookd sync` call it.
- `src/commands/sync.ts` — `runSync()`: the `cookd sync` command (headless; loads creds, calls `runSyncOnce`, exits).
- `src/commands/uninstall.ts` — `runUninstall()`: removes the hook block + the binary.
- `src/hooks/platform.ts` — `releaseAssetName()`: maps `process.platform`/`process.arch` → release asset filename (or `null` if unsupported). Pure.
- `src/hooks/checksum.ts` — `sha256Hex()` + `verifyChecksum()`. Pure.
- `src/hooks/binary.ts` — `binaryPath()`, `isBinaryInstalled()`, `downloadBinary()`.
- `src/hooks/settings.ts` — Claude `settings.json` path + `readSettings`, `installSessionEndHook`, `removeCookdHook`, `hasCookdHook`. The only file that writes `~/.claude/settings.json`.
- `src/hooks/install.ts` — `installAutoSync()` / `uninstallAutoSync()` orchestration (binary + hook together).
- `src/ui/ink/Consent.tsx` — the Ink consent screen (reuses theme + box chrome).

**Modified files:**
- `src/cli.ts` — register `sync` and `uninstall` commands.
- `src/commands/watch.ts` — delegate its sync to `runSyncOnce`.
- `src/commands/init.tsx` — re-init guard (skip press code when already linked) + consent prompt after linking (TTY) / `runInitPlain` (non-TTY).
- `.github/workflows/release.yml` — publish a `SHA256SUMS` file with the binaries.

**Conventions to follow (from CODEBASE-ARCHITECTURE.md / ADR-011):**
- ESM with `.js` import specifiers on TS sources.
- Route all outbound through `syncWindowState`/`sync_queue`; do not add a new POST path.
- Subprocess: `execFile()` with arg arrays only, never a shell string. (No subprocess is needed here, but if added, obey this.)
- Ink flows ship a `runInitPlain`-style plain-TTY fallback.
- Theme tokens from `src/ui/theme.ts`; chrome from `src/ui/ink/*`.
- Local state under `~/.cookd/` (`COOKD_DIR` from `auth/credentials.ts`).

---

## Task 1: Extract the shared headless sync (`runSyncOnce`)

**Files:**
- Create: `src/sync/run.ts`
- Modify: `src/commands/watch.ts` (delegate `syncNow` to the new function)
- Test: `test/sync/run.test.ts`

- [ ] **Step 1: Write the failing test**

`test/sync/run.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/sync/client.js', () => ({ syncWindowState: vi.fn() }));
vi.mock('../../src/adapters/registry.js', () => ({ detectAdapter: vi.fn() }));
vi.mock('../../src/adapters/claude-code/calibration-store.js', () => ({
  loadCalibration: () => ({ cpLimit: 1000, confidence: 'high' }),
  saveCalibration: vi.fn(),
  isStale: () => false,
}));

import { runSyncOnce } from '../../src/sync/run.js';
import { syncWindowState } from '../../src/sync/client.js';
import { detectAdapter } from '../../src/adapters/registry.js';
import type { Credentials } from '../../src/auth/credentials.js';

const creds: Credentials = { deviceToken: 't', handle: 'you', deviceId: 'd', linkedAt: 'now' };

describe('runSyncOnce', () => {
  beforeEach(() => vi.clearAllMocks());

  it('builds a window summary from adapter events and sends it once', async () => {
    (detectAdapter as any).mockResolvedValue({
      events: async () => ([{ ts: new Date(), model: 'claude-sonnet-4-6', inputTokens: 10, outputTokens: 5, cacheCreationTokens: 0, cacheCreation1hTokens: 0, cacheReadTokens: 0 }]),
      getSessionStats: () => ({ prompts: 1, yoloPrompts: 0, toolCounts: {}, toolErrors: 0 }),
    });
    const result = await runSyncOnce(creds);
    expect(syncWindowState).toHaveBeenCalledTimes(1);
    expect(result.synced).toBe(true);
  });

  it('returns synced=false when no agent is detected', async () => {
    (detectAdapter as any).mockResolvedValue(null);
    const result = await runSyncOnce(creds);
    expect(syncWindowState).not.toHaveBeenCalled();
    expect(result.synced).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/sync/run.test.ts`
Expected: FAIL — cannot find module `src/sync/run.js`.

- [ ] **Step 3: Write minimal implementation**

`src/sync/run.ts` (extract the logic currently inline in `watch.ts` `syncNow`, made stateless):
```typescript
import { detectAdapter } from '../adapters/registry.js';
import { ClaudeCodeAdapter } from '../adapters/claude-code/index.js';
import { computeWindow, WINDOW_MS } from '../adapters/claude-code/window.js';
import { calibrate, extractLatestResetTime } from '../adapters/claude-code/calibrate.js';
import { computeModelBreakdown, computeDailyStats, computeTonight } from '../adapters/claude-code/wrapped.js';
import { loadCalibration, saveCalibration, isStale } from '../adapters/claude-code/calibration-store.js';
import { syncWindowState } from './client.js';
import type { WindowSummary, SessionStatus, CookedEventPayload } from './events.js';
import { saveCredentials, type Credentials } from '../auth/credentials.js';

function deriveStatus(ratio: number, limit: number | null): SessionStatus {
  if (!limit || ratio < 0.1) return 'idle';
  if (ratio >= 0.95) return 'cookd';
  return 'cooking';
}

export interface SyncResult { synced: boolean; creds: Credentials; }

/** One-shot sync: read current usage, build the WindowSummary, push it via the queue.
 *  Persists an updated cooked-event marker onto creds when a fresh cook is sent. */
export async function runSyncOnce(creds: Credentials): Promise<SyncResult> {
  const adapter = await detectAdapter();
  if (!adapter) return { synced: false, creds };

  const ccAdapter = adapter instanceof ClaudeCodeAdapter ? adapter : null;
  const events = await adapter.events();

  let cal = loadCalibration();
  if (!cal || isStale(cal)) {
    const r = calibrate(events);
    cal = { cpLimit: r.cpLimit, confidence: r.confidence, calibratedAt: new Date().toISOString() };
    saveCalibration(cal);
  }
  const limit = cal?.cpLimit ?? null;
  const window = computeWindow(events, limit);

  const resetFromError = extractLatestResetTime(events);
  const oldest = window.events[0];
  const resetsAt = resetFromError?.toISOString()
    ?? (oldest ? new Date(oldest.ts.getTime() + WINDOW_MS).toISOString() : null);

  const sessionStats = ccAdapter?.getSessionStats() ?? { prompts: 0, yoloPrompts: 0, toolCounts: {}, toolErrors: 0 };
  const today = new Date().toLocaleDateString('en-CA');

  const summary: WindowSummary = {
    status: deriveStatus(window.ratio, limit),
    usedTokens: window.weightedTokens,
    limitTokens: limit,
    pctUsed: limit != null ? window.ratio * 100 : null,
    windowStart: window.windowStart.toISOString(),
    resetsAt,
    plan: null,
    calibrationConfidence: cal?.confidence ?? 'none',
    modelBreakdown: Object.fromEntries(computeModelBreakdown(window.events).map(s => [s.model, s.cpTokens])),
    dailyStats: computeDailyStats(events, today, limit != null ? window.ratio * 100 : 0, sessionStats),
    tonight: computeTonight(window.events, sessionStats),
  };

  let out = creds;
  let cookedEvent: CookedEventPayload | undefined;
  if (summary.status === 'cookd' && resetsAt && resetsAt !== creds.lastCookedEventSentAt) {
    const rlEvent = events.find(e => e.limitResetAt);
    const topModel = Object.entries(summary.modelBreakdown).sort((a, b) => b[1] - a[1])[0]?.[0];
    cookedEvent = {
      cookedAt: rlEvent?.ts.toISOString() ?? resetsAt,
      usedTokens: summary.usedTokens,
      limitTokens: summary.limitTokens ?? 0,
      timeToCookMins: summary.tonight?.timeToCookMins,
      topModel,
      resetsAt,
    };
  }

  await syncWindowState(creds, cookedEvent ? { ...summary, cookedEvent } : summary);

  if (cookedEvent && resetsAt) {
    out = { ...creds, lastCookedEventSentAt: resetsAt };
    await saveCredentials(out);
  }
  return { synced: true, creds: out };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/sync/run.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Refactor `watch.ts` to delegate to `runSyncOnce`**

In `src/commands/watch.ts`, replace the body of the inner `syncNow(events)` usage: keep the throttle logic (`bigChange`/`hasRLEvent`/`heartbeat`) but call the shared function instead of the inline summary build. Minimal change — inside the debounce, after deciding to sync:
```typescript
// was: await syncNow(events);
const res = await runSyncOnce(creds!);
creds = res.creds;
lastSyncTime = Date.now();
```
Add `import { runSyncOnce } from '../sync/run.js';` and delete the now-dead inline `syncNow`/`deriveStatus` in `watch.ts`. Run the existing suite to confirm no regression: `npx vitest run`.

- [ ] **Step 6: Commit**

```bash
git add src/sync/run.ts src/commands/watch.ts test/sync/run.test.ts
git commit -m "refactor: extract shared runSyncOnce for headless sync"
```

---

## Task 2: The `cookd sync` command

**Files:**
- Create: `src/commands/sync.ts`
- Modify: `src/cli.ts` (register `sync`)
- Test: `test/commands/sync.test.ts`

- [ ] **Step 1: Write the failing test**

`test/commands/sync.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/auth/credentials.js', () => ({ loadCredentials: vi.fn() }));
vi.mock('../../src/sync/run.js', () => ({ runSyncOnce: vi.fn() }));

import { runSync } from '../../src/commands/sync.js';
import { loadCredentials } from '../../src/auth/credentials.js';
import { runSyncOnce } from '../../src/sync/run.js';

describe('runSync (cookd sync)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('does nothing when not linked (no throw, no sync)', async () => {
    (loadCredentials as any).mockResolvedValue(null);
    await runSync();
    expect(runSyncOnce).not.toHaveBeenCalled();
  });

  it('runs one sync when linked', async () => {
    (loadCredentials as any).mockResolvedValue({ deviceToken: 't', handle: 'you', deviceId: 'd', linkedAt: 'now' });
    (runSyncOnce as any).mockResolvedValue({ synced: true, creds: {} });
    await runSync();
    expect(runSyncOnce).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/commands/sync.test.ts`
Expected: FAIL — cannot find module `src/commands/sync.js`.

- [ ] **Step 3: Write minimal implementation**

`src/commands/sync.ts` (headless; silent; never throws out — the hook must not surface errors to Claude):
```typescript
import { loadCredentials } from '../auth/credentials.js';
import { runSyncOnce } from '../sync/run.js';

/** Headless one-shot sync. Invoked by the SessionEnd hook (and reusable manually).
 *  Fails quietly: a hook must never break the user's Claude session. */
export async function runSync(): Promise<void> {
  try {
    const creds = await loadCredentials();
    if (!creds) return; // not linked — nothing to do
    await runSyncOnce(creds);
  } catch {
    // swallow: queued events retry on the next sync; never crash the hook
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/commands/sync.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Register the command in `cli.ts`**

In `src/cli.ts`, after the `wrapped` command block, add:
```typescript
program
  .command('sync')
  .description('one-shot usage sync (used by the auto-sync hook)')
  .action(async () => {
    const { runSync } = await import('./commands/sync.js');
    await runSync();
  });
```

- [ ] **Step 6: Commit**

```bash
git add src/commands/sync.ts src/cli.ts test/commands/sync.test.ts
git commit -m "feat: add headless cookd sync command"
```

---

## Task 3: Platform → release-asset mapping

**Files:**
- Create: `src/hooks/platform.ts`
- Test: `test/hooks/platform.test.ts`

- [ ] **Step 1: Write the failing test**

`test/hooks/platform.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { releaseAssetName } from '../../src/hooks/platform.js';

describe('releaseAssetName', () => {
  it('maps linux x64', () => expect(releaseAssetName('linux', 'x64')).toBe('cookd-linux-x64'));
  it('maps linux arm64', () => expect(releaseAssetName('linux', 'arm64')).toBe('cookd-linux-arm64'));
  it('maps darwin arm64', () => expect(releaseAssetName('darwin', 'arm64')).toBe('cookd-darwin-arm64'));
  it('maps darwin x64', () => expect(releaseAssetName('darwin', 'x64')).toBe('cookd-darwin-x64'));
  it('maps windows x64 with .exe', () => expect(releaseAssetName('win32', 'x64')).toBe('cookd-windows-x64.exe'));
  it('returns null for unsupported (win arm64)', () => expect(releaseAssetName('win32', 'arm64')).toBeNull());
  it('returns null for unknown', () => expect(releaseAssetName('sunos', 'x64')).toBeNull());
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/hooks/platform.test.ts`
Expected: FAIL — cannot find module `src/hooks/platform.js`.

- [ ] **Step 3: Write minimal implementation**

`src/hooks/platform.ts` (targets mirror `release.yml`'s matrix exactly):
```typescript
// Must match the `target` values in .github/workflows/release.yml.
const TARGETS: Record<string, string> = {
  'linux-x64': 'cookd-linux-x64',
  'linux-arm64': 'cookd-linux-arm64',
  'darwin-x64': 'cookd-darwin-x64',
  'darwin-arm64': 'cookd-darwin-arm64',
  'win32-x64': 'cookd-windows-x64.exe',
};

/** Release asset filename for this platform, or null if no prebuilt binary exists. */
export function releaseAssetName(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): string | null {
  return TARGETS[`${platform}-${arch}`] ?? null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/hooks/platform.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/hooks/platform.ts test/hooks/platform.test.ts
git commit -m "feat: map platform to release asset name"
```

---

## Task 4: Checksum verification

**Files:**
- Create: `src/hooks/checksum.ts`
- Test: `test/hooks/checksum.test.ts`

- [ ] **Step 1: Write the failing test**

`test/hooks/checksum.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { sha256Hex, verifyChecksum, parseSums } from '../../src/hooks/checksum.js';

describe('checksum', () => {
  const data = Buffer.from('hello cookd');
  // sha256("hello cookd") precomputed:
  const expected = 'e6b8b0e7d2a9d3f6b8c9...'; // replace with real value in Step 3 note

  it('sha256Hex is stable and lowercase hex', () => {
    const h = sha256Hex(data);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256Hex(data)).toBe(h);
  });

  it('verifyChecksum passes for matching hash', () => {
    expect(verifyChecksum(data, sha256Hex(data))).toBe(true);
  });

  it('verifyChecksum fails and is case-insensitive on mismatch', () => {
    expect(verifyChecksum(data, '0'.repeat(64))).toBe(false);
    expect(verifyChecksum(data, sha256Hex(data).toUpperCase())).toBe(true);
  });

  it('parseSums finds the hash for a given filename', () => {
    const sums = `${sha256Hex(data)}  cookd-linux-x64\n${'a'.repeat(64)}  cookd-darwin-arm64\n`;
    expect(parseSums(sums, 'cookd-linux-x64')).toBe(sha256Hex(data));
    expect(parseSums(sums, 'cookd-missing')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/hooks/checksum.test.ts`
Expected: FAIL — cannot find module `src/hooks/checksum.js`.

- [ ] **Step 3: Write minimal implementation**

`src/hooks/checksum.ts`:
```typescript
import { createHash } from 'crypto';

export function sha256Hex(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

export function verifyChecksum(data: Buffer, expectedHex: string): boolean {
  return sha256Hex(data) === expectedHex.trim().toLowerCase();
}

/** Parse a `SHA256SUMS` file ("<hex>  <filename>" per line) → hash for `filename`, or null. */
export function parseSums(contents: string, filename: string): string | null {
  for (const line of contents.split('\n')) {
    const m = /^([0-9a-fA-F]{64})\s+\*?(.+)$/.exec(line.trim());
    if (m && m[2].trim() === filename) return m[1].toLowerCase();
  }
  return null;
}
```

Note for the implementer: the `expected` const in Step 1 is a placeholder comment only — the real assertions use `sha256Hex(data)` directly, so no hard-coded digest is needed. Delete the unused `expected` line.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/hooks/checksum.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/hooks/checksum.ts test/hooks/checksum.test.ts
git commit -m "feat: add sha256 checksum verification for binary download"
```

---

## Task 5: Binary download + install

**Files:**
- Create: `src/hooks/binary.ts`
- Test: `test/hooks/binary.test.ts`

- [ ] **Step 1: Write the failing test** (pure parts: path + URL building + verify-then-write; network is injected)

`test/hooks/binary.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest';
import { assetUrl, sumsUrl, installFromBuffers, BinaryInstallError } from '../../src/hooks/binary.js';
import { sha256Hex } from '../../src/hooks/checksum.js';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdtempSync, readFileSync, existsSync } from 'fs';

describe('binary provisioning', () => {
  it('builds asset + sums URLs from version', () => {
    const base = 'https://example.com/releases/download';
    expect(assetUrl(base, '1.2.3', 'cookd-linux-x64')).toBe(`${base}/v1.2.3/cookd-linux-x64`);
    expect(sumsUrl(base, '1.2.3')).toBe(`${base}/v1.2.3/SHA256SUMS`);
  });

  it('writes an executable when the checksum matches', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cookd-bin-'));
    const dest = join(dir, 'cookd');
    const bin = Buffer.from('#!/binary\x00payload');
    const sums = `${sha256Hex(bin)}  cookd-linux-x64\n`;
    installFromBuffers(bin, sums, 'cookd-linux-x64', dest);
    expect(existsSync(dest)).toBe(true);
    expect(readFileSync(dest).equals(bin)).toBe(true);
  });

  it('refuses to write on checksum mismatch', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cookd-bin-'));
    const dest = join(dir, 'cookd');
    const bin = Buffer.from('payload');
    const sums = `${'0'.repeat(64)}  cookd-linux-x64\n`;
    expect(() => installFromBuffers(bin, sums, 'cookd-linux-x64', dest)).toThrow(BinaryInstallError);
    expect(existsSync(dest)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/hooks/binary.test.ts`
Expected: FAIL — cannot find module `src/hooks/binary.js`.

- [ ] **Step 3: Write minimal implementation**

`src/hooks/binary.ts`:
```typescript
import { join } from 'path';
import { homedir } from 'os';
import { mkdirSync, writeFileSync, chmodSync, renameSync, existsSync } from 'fs';
import { releaseAssetName } from './platform.js';
import { parseSums, verifyChecksum } from './checksum.js';

const RELEASE_BASE =
  process.env.COOKD_RELEASE_BASE ?? 'https://github.com/codeclowns01/cookd/releases/download';

export class BinaryInstallError extends Error {}

export function binDir(): string { return join(homedir(), '.cookd', 'bin'); }
export function binaryPath(): string {
  return join(binDir(), process.platform === 'win32' ? 'cookd.exe' : 'cookd');
}
export function isBinaryInstalled(): boolean { return existsSync(binaryPath()); }

export function assetUrl(base: string, version: string, asset: string): string {
  return `${base}/v${version}/${asset}`;
}
export function sumsUrl(base: string, version: string): string {
  return `${base}/v${version}/SHA256SUMS`;
}

/** Verify then atomically write the binary. Throws BinaryInstallError on mismatch. */
export function installFromBuffers(bin: Buffer, sums: string, asset: string, dest: string): void {
  const expected = parseSums(sums, asset);
  if (!expected) throw new BinaryInstallError(`no checksum for ${asset} in SHA256SUMS`);
  if (!verifyChecksum(bin, expected)) throw new BinaryInstallError(`checksum mismatch for ${asset}`);
  mkdirSync(join(dest, '..'), { recursive: true });
  const tmp = `${dest}.tmp`;
  writeFileSync(tmp, bin);
  if (process.platform !== 'win32') chmodSync(tmp, 0o755);
  renameSync(tmp, dest); // atomic
}

/** Download the matching binary + SHA256SUMS for `version` and install to ~/.cookd/bin. */
export async function downloadBinary(version: string): Promise<void> {
  const asset = releaseAssetName();
  if (!asset) {
    throw new BinaryInstallError(`no prebuilt cookd binary for ${process.platform}/${process.arch}`);
  }
  const [binRes, sumsRes] = await Promise.all([
    fetch(assetUrl(RELEASE_BASE, version, asset)),
    fetch(sumsUrl(RELEASE_BASE, version)),
  ]);
  if (!binRes.ok) throw new BinaryInstallError(`download failed: ${binRes.status}`);
  if (!sumsRes.ok) throw new BinaryInstallError(`checksums fetch failed: ${sumsRes.status}`);
  const bin = Buffer.from(await binRes.arrayBuffer());
  const sums = await sumsRes.text();
  installFromBuffers(bin, sums, asset, binaryPath());
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/hooks/binary.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/hooks/binary.ts test/hooks/binary.test.ts
git commit -m "feat: download + checksum-verify the cookd binary"
```

---

## Task 6: Claude `settings.json` install / merge / remove

**Files:**
- Create: `src/hooks/settings.ts`
- Test: `test/hooks/settings.test.ts`

- [ ] **Step 1: Write the failing test** (uses a temp HOME-like path via an injected settings path)

`test/hooks/settings.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { installSessionEndHook, removeCookdHook, hasCookdHook, SettingsError } from '../../src/hooks/settings.js';

function tmpSettings(initial?: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'cookd-settings-'));
  const p = join(dir, 'settings.json');
  if (initial !== undefined) writeFileSync(p, initial);
  return p;
}

describe('settings.json hook management', () => {
  it('adds a SessionEnd hook to an empty (missing) file', () => {
    const p = tmpSettings();
    installSessionEndHook(p, '/home/u/.cookd/bin/cookd');
    const s = JSON.parse(readFileSync(p, 'utf8'));
    expect(s.hooks.SessionEnd[0].hooks[0].command).toContain('/home/u/.cookd/bin/cookd sync');
    expect(hasCookdHook(p)).toBe(true);
  });

  it('preserves existing unrelated settings and hooks (merge, not overwrite)', () => {
    const p = tmpSettings(JSON.stringify({
      theme: 'dark',
      hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo hi' }] }] },
    }, null, 2));
    installSessionEndHook(p, '/bin/cookd');
    const s = JSON.parse(readFileSync(p, 'utf8'));
    expect(s.theme).toBe('dark');
    expect(s.hooks.PreToolUse).toHaveLength(1);
    expect(s.hooks.SessionEnd[0].hooks[0].command).toContain('/bin/cookd sync');
  });

  it('writes a backup before modifying', () => {
    const p = tmpSettings(JSON.stringify({ theme: 'dark' }));
    installSessionEndHook(p, '/bin/cookd');
    expect(existsSync(`${p}.cookd-bak`)).toBe(true);
  });

  it('is idempotent — no duplicate cookd hook on re-install', () => {
    const p = tmpSettings();
    installSessionEndHook(p, '/bin/cookd');
    installSessionEndHook(p, '/bin/cookd');
    const s = JSON.parse(readFileSync(p, 'utf8'));
    const cookdHooks = s.hooks.SessionEnd.flatMap((g: any) => g.hooks).filter((h: any) => h._cookd);
    expect(cookdHooks).toHaveLength(1);
  });

  it('removeCookdHook removes only cookd, leaving other hooks intact', () => {
    const p = tmpSettings(JSON.stringify({
      hooks: { SessionEnd: [{ hooks: [{ type: 'command', command: 'other' }] }] },
    }));
    installSessionEndHook(p, '/bin/cookd');
    removeCookdHook(p);
    const s = JSON.parse(readFileSync(p, 'utf8'));
    expect(hasCookdHook(p)).toBe(false);
    const cmds = s.hooks.SessionEnd.flatMap((g: any) => g.hooks).map((h: any) => h.command);
    expect(cmds).toContain('other');
  });

  it('aborts on an unparseable existing file (never blind-overwrites)', () => {
    const p = tmpSettings('{ this is not json');
    expect(() => installSessionEndHook(p, '/bin/cookd')).toThrow(SettingsError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/hooks/settings.test.ts`
Expected: FAIL — cannot find module `src/hooks/settings.js`.

- [ ] **Step 3: Write minimal implementation**

`src/hooks/settings.ts`:
```typescript
import { homedir } from 'os';
import { join } from 'path';
import { readFileSync, writeFileSync, copyFileSync, existsSync, renameSync, mkdirSync } from 'fs';

export class SettingsError extends Error {}

export function claudeSettingsPath(): string {
  return join(homedir(), '.claude', 'settings.json');
}

interface HookEntry { type: string; command: string; async?: boolean; timeout?: number; _cookd?: boolean; }
interface HookGroup { matcher?: string; hooks: HookEntry[]; }
interface Settings { hooks?: Record<string, HookGroup[]>; [k: string]: unknown; }

function read(path: string): Settings {
  if (!existsSync(path)) return {};
  const raw = readFileSync(path, 'utf8').trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Settings;
  } catch {
    throw new SettingsError(
      `~/.claude/settings.json is not valid JSON — refusing to modify it. Fix or remove it and retry.`,
    );
  }
}

function writeAtomic(path: string, settings: Settings): void {
  mkdirSync(join(path, '..'), { recursive: true });
  const tmp = `${path}.cookd-tmp`;
  writeFileSync(tmp, JSON.stringify(settings, null, 2) + '\n', 'utf8');
  renameSync(tmp, path);
}

function cookdEntry(binaryPath: string): HookEntry {
  return { type: 'command', command: `${binaryPath} sync`, async: true, timeout: 30, _cookd: true };
}

export function hasCookdHook(path: string): boolean {
  const s = read(path);
  return (s.hooks?.SessionEnd ?? []).some(g => g.hooks.some(h => h._cookd));
}

export function installSessionEndHook(path: string, binaryPath: string): void {
  const s = read(path); // throws SettingsError if unparseable — before any write
  if (existsSync(path)) copyFileSync(path, `${path}.cookd-bak`);
  s.hooks ??= {};
  s.hooks.SessionEnd ??= [];
  // remove any prior cookd entries first (idempotent)
  for (const g of s.hooks.SessionEnd) g.hooks = g.hooks.filter(h => !h._cookd);
  s.hooks.SessionEnd = s.hooks.SessionEnd.filter(g => g.hooks.length > 0);
  s.hooks.SessionEnd.push({ hooks: [cookdEntry(binaryPath)] });
  writeAtomic(path, s);
}

export function removeCookdHook(path: string): void {
  if (!existsSync(path)) return;
  const s = read(path);
  if (!s.hooks?.SessionEnd) return;
  for (const g of s.hooks.SessionEnd) g.hooks = g.hooks.filter(h => !h._cookd);
  s.hooks.SessionEnd = s.hooks.SessionEnd.filter(g => g.hooks.length > 0);
  if (s.hooks.SessionEnd.length === 0) delete s.hooks.SessionEnd;
  writeAtomic(path, s);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/hooks/settings.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/hooks/settings.ts test/hooks/settings.test.ts
git commit -m "feat: safe settings.json SessionEnd hook install/remove"
```

---

## Task 7: Install orchestration (`installAutoSync` / `uninstallAutoSync`)

**Files:**
- Create: `src/hooks/install.ts`
- Test: `test/hooks/install.test.ts`

- [ ] **Step 1: Write the failing test**

`test/hooks/install.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/hooks/binary.js', () => ({
  downloadBinary: vi.fn(), isBinaryInstalled: vi.fn(() => false),
  binaryPath: () => '/home/u/.cookd/bin/cookd',
}));
vi.mock('../../src/hooks/settings.js', () => ({
  installSessionEndHook: vi.fn(), removeCookdHook: vi.fn(),
  claudeSettingsPath: () => '/home/u/.claude/settings.json',
}));

import { installAutoSync, uninstallAutoSync } from '../../src/hooks/install.js';
import { downloadBinary } from '../../src/hooks/binary.js';
import { installSessionEndHook, removeCookdHook } from '../../src/hooks/settings.js';

describe('auto-sync install orchestration', () => {
  beforeEach(() => vi.clearAllMocks());

  it('downloads the binary then writes the hook', async () => {
    await installAutoSync('1.2.3');
    expect(downloadBinary).toHaveBeenCalledWith('1.2.3');
    expect(installSessionEndHook).toHaveBeenCalledWith('/home/u/.claude/settings.json', '/home/u/.cookd/bin/cookd');
  });

  it('does not write the hook if the binary download fails', async () => {
    (downloadBinary as any).mockRejectedValueOnce(new Error('offline'));
    await expect(installAutoSync('1.2.3')).rejects.toThrow();
    expect(installSessionEndHook).not.toHaveBeenCalled();
  });

  it('uninstall removes the hook', async () => {
    await uninstallAutoSync();
    expect(removeCookdHook).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/hooks/install.test.ts`
Expected: FAIL — cannot find module `src/hooks/install.js`.

- [ ] **Step 3: Write minimal implementation**

`src/hooks/install.ts`:
```typescript
import { rmSync, existsSync } from 'fs';
import { downloadBinary, binaryPath, isBinaryInstalled } from './binary.js';
import { installSessionEndHook, removeCookdHook, claudeSettingsPath } from './settings.js';

/** Provision the binary, then register the hook. Order matters: never write a hook
 *  pointing at a binary that isn't there. Throws on failure (caller shows the error). */
export async function installAutoSync(version: string): Promise<void> {
  if (!isBinaryInstalled()) await downloadBinary(version);
  installSessionEndHook(claudeSettingsPath(), binaryPath());
}

export async function uninstallAutoSync(): Promise<void> {
  removeCookdHook(claudeSettingsPath());
  const bin = binaryPath();
  if (existsSync(bin)) rmSync(bin, { force: true });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/hooks/install.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/hooks/install.ts test/hooks/install.test.ts
git commit -m "feat: orchestrate binary + hook install/uninstall"
```

---

## Task 8: The `cookd uninstall` command

**Files:**
- Create: `src/commands/uninstall.ts`
- Modify: `src/cli.ts` (register `uninstall`)
- Test: `test/commands/uninstall.test.ts`

- [ ] **Step 1: Write the failing test**

`test/commands/uninstall.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('../../src/hooks/install.js', () => ({ uninstallAutoSync: vi.fn() }));
import { runUninstall } from '../../src/commands/uninstall.js';
import { uninstallAutoSync } from '../../src/hooks/install.js';

describe('runUninstall', () => {
  beforeEach(() => vi.clearAllMocks());
  it('calls uninstallAutoSync', async () => {
    await runUninstall();
    expect(uninstallAutoSync).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/commands/uninstall.test.ts`
Expected: FAIL — cannot find module `src/commands/uninstall.js`.

- [ ] **Step 3: Write minimal implementation**

`src/commands/uninstall.ts`:
```typescript
import chalk from 'chalk';
import { uninstallAutoSync } from '../hooks/install.js';
import { FAINT, STAMP } from '../ui/theme.js';

export async function runUninstall(): Promise<void> {
  await uninstallAutoSync();
  console.log(chalk.hex(STAMP).bold('  auto-sync removed.'));
  console.log(chalk.hex(FAINT)('  the SessionEnd hook and local binary are gone. your account is untouched.'));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/commands/uninstall.test.ts`
Expected: PASS.

- [ ] **Step 5: Register in `cli.ts`**

```typescript
program
  .command('uninstall')
  .description('turn off auto-sync (remove the hook + local binary)')
  .action(async () => {
    const { runUninstall } = await import('./commands/uninstall.js');
    await runUninstall();
  });
```

- [ ] **Step 6: Commit**

```bash
git add src/commands/uninstall.ts src/cli.ts test/commands/uninstall.test.ts
git commit -m "feat: add cookd uninstall command"
```

---

## Task 9: Re-init guard (already-linked device syncs silently)

**Files:**
- Modify: `src/commands/init.tsx` (both `InitApp.run` and `runInitPlain`)
- Test: `test/commands/init-guard.test.ts`

- [ ] **Step 1: Write the failing test** (extract the guard decision into a pure helper so it's testable)

`test/commands/init-guard.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { shouldSkipPressCode } from '../../src/commands/init-guard.js';

describe('shouldSkipPressCode', () => {
  it('true when valid credentials exist', () => {
    expect(shouldSkipPressCode({ deviceToken: 't', handle: 'you', deviceId: 'd', linkedAt: 'now' })).toBe(true);
  });
  it('false when no credentials', () => {
    expect(shouldSkipPressCode(null)).toBe(false);
  });
  it('false when credentials are missing a device token', () => {
    expect(shouldSkipPressCode({ handle: 'you', deviceId: 'd', linkedAt: 'now' } as any)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/commands/init-guard.test.ts`
Expected: FAIL — cannot find module `src/commands/init-guard.js`.

- [ ] **Step 3: Write minimal implementation**

`src/commands/init-guard.ts`:
```typescript
import type { Credentials } from '../auth/credentials.js';

/** A returning, already-linked device should sync silently — no new press code. */
export function shouldSkipPressCode(creds: Credentials | null): boolean {
  return !!creds && typeof creds.deviceToken === 'string' && creds.deviceToken.length > 0;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/commands/init-guard.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Wire the guard into `init.tsx`**

In `runInitPlain` (and the Ink `run()`), after `const existing = await loadCredentials();` and adapter detection, branch **before** `deviceLinkStart`:
```typescript
import { shouldSkipPressCode } from './init-guard.js';
import { runSyncOnce } from '../sync/run.js';
// ...
if (shouldSkipPressCode(existing)) {
  // already linked → just sync, no press code
  await runSyncOnce(existing!);
  p(chalk.green.bold('  synced.'));               // plain path
  // (Ink path: setState('success') / show a brief "synced" confirmation instead of the press-code UI)
  return;
}
```
For the Ink `InitApp`, add a `'resync'` state that renders a short "re-syncing…" → "synced" confirmation and calls `runSyncOnce(existing)` instead of entering `press-code`. Keep the full link flow only for the `!shouldSkipPressCode` branch. Run `npx vitest run` to confirm no regressions.

- [ ] **Step 6: Commit**

```bash
git add src/commands/init-guard.ts src/commands/init.tsx test/commands/init-guard.test.ts
git commit -m "feat: re-init guard — linked device re-run syncs silently"
```

---

## Task 10: Consent screen + wiring auto-sync into signup

**Files:**
- Create: `src/ui/ink/Consent.tsx`
- Modify: `src/commands/init.tsx` (offer consent after a successful first link; both Ink and `runInitPlain`)
- Test: `test/hooks/consent-copy.test.ts` (assert the exact-edit copy contract exists)

- [ ] **Step 1: Write the failing test** (guards the "show the exact edit" trust contract)

`test/hooks/consent-copy.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { consentLines } from '../../src/ui/ink/Consent.js';

describe('consent copy contract', () => {
  const lines = consentLines('/home/u/.cookd/bin/cookd');
  const text = lines.join('\n');
  it('names the file being edited', () => expect(text).toContain('~/.claude/settings.json'));
  it('shows the SessionEnd + sync command', () => {
    expect(text).toContain('SessionEnd');
    expect(text).toContain('/home/u/.cookd/bin/cookd sync');
  });
  it('states the read/never boundary and uninstall', () => {
    expect(text).toContain('only that session');
    expect(text.toLowerCase()).toContain('never');
    expect(text).toContain('cookd uninstall');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/hooks/consent-copy.test.ts`
Expected: FAIL — cannot find module `src/ui/ink/Consent.js`.

- [ ] **Step 3: Write minimal implementation**

`src/ui/ink/Consent.tsx` (export both the copy contract and an Ink component reusing theme/box chrome):
```tsx
import React from 'react';
import { Text } from 'ink';
import chalk from 'chalk';
import { STAMP, MUT, FAINT, FLAME } from '../theme.js';
import { BoxDivider, BoxBlank, BoxBottom } from './Box.js';

/** The exact-edit copy shown before we touch settings.json. Kept pure + tested. */
export function consentLines(binaryPath: string): string[] {
  return [
    'keep your stats fresh automatically?',
    '',
    'cookd will add this to  ~/.claude/settings.json :',
    `    "SessionEnd" → { "command": "${binaryPath} sync", "async": true }`,
    '',
    'what it does:  runs a sync when a Claude session ends.',
    'what it reads: only that session’s usage numbers.',
    'what it never: touches your prompts, code, or files.',
    '',
    'we back up your settings first and only add — never overwrite.',
    'remove anytime:  cookd uninstall',
  ];
}

export function Consent({ binaryPath }: { binaryPath: string }): React.ReactElement {
  const lines = consentLines(binaryPath);
  return (
    <>
      <BoxDivider />
      <BoxBlank />
      {lines.map((l, i) => (
        <Text key={i}>{'  ' + chalk.hex(i === 0 ? STAMP : FAINT)(l)}</Text>
      ))}
      <BoxBlank />
      <Text>{'  ' + chalk.hex(FLAME).bold('add this line? [Y/n]')}</Text>
      <BoxBottom />
    </>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/hooks/consent-copy.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Wire consent into the signup flow**

After a **successful first link** (the `!shouldSkipPressCode` branch, once `saveCredentials(creds)` + `syncAfterLink` complete), offer auto-sync:

- **Plain path (`runInitPlain`)** — prompt via a minimal readline confirm; on `y`:
```typescript
import { installAutoSync } from '../hooks/install.js';
import { consentLines } from '../ui/ink/Consent.js';
import { binaryPath } from '../hooks/binary.js';
import { readFileSync } from 'fs';
const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string };
// print consentLines(binaryPath()); read a single y/n line
if (answeredYes) {
  try {
    p(chalk.hex(FAINT)('  setting up auto-sync…'));
    await installAutoSync(pkg.version);
    p(chalk.green.bold('  auto-sync on.'));
  } catch (e) {
    p(chalk.hex(FLAME)('  auto-sync setup skipped: ' + (e instanceof Error ? e.message : 'unknown')));
    p(chalk.hex(FAINT)('  you can still refresh anytime by re-running the command.'));
  }
} else {
  p(chalk.hex(FAINT)('  auto-sync off — re-run the command anytime to refresh.'));
}
```
- **Ink path** — add a `'consent'` state rendering `<Consent binaryPath={binaryPath()} />`, read a keypress via Ink's `useInput`, then call `installAutoSync(pkg.version)` and show `'auto-sync on'` / the skip message. Reuse the existing spinner for "setting up auto-sync…".
- **Non-interactive guard:** in `runInitPlain`, if `!process.stdin.isTTY`, **do not prompt and do not install** — print the "off — re-run to refresh" line. (ADR-011: non-interactive never auto-installs.)

Run `npx vitest run` and a manual `node dist/cli.js` smoke after `npm run build`.

- [ ] **Step 6: Commit**

```bash
git add src/ui/ink/Consent.tsx src/commands/init.tsx test/hooks/consent-copy.test.ts
git commit -m "feat: consent screen + wire auto-sync install into signup"
```

---

## Task 11: Publish `SHA256SUMS` in the release

**Files:**
- Modify: `.github/workflows/release.yml` (create-release job)

- [ ] **Step 1: Add a checksums step before `create release`**

In the `create-release` job, after `download all binaries` and before `create release`, add:
```yaml
      - name: generate checksums
        run: |
          cd binaries
          sha256sum cookd-* > SHA256SUMS
          cat SHA256SUMS
```
And extend the release `files` glob to include it:
```yaml
      - name: create release
        uses: softprops/action-gh-release@v2
        with:
          files: |
            binaries/*
            binaries/SHA256SUMS
          generate_release_notes: true
```
Note for the implementer: `sha256sum` output format is `<hex>  <filename>`, exactly what `parseSums` (Task 4) expects. On the Windows runner this job runs on `ubuntu-latest`, so `sha256sum` is available.

- [ ] **Step 2: Verify locally (dry parse)**

Run a quick local check that `parseSums` accepts real `sha256sum` output:
```bash
printf 'payload' > /tmp/cookd-linux-x64 && (cd /tmp && sha256sum cookd-linux-x64 > SHA256SUMS)
node -e "import('./dist/hooks/checksum.js').then(m=>{const fs=require('fs');console.log(m.parseSums(fs.readFileSync('/tmp/SHA256SUMS','utf8'),'cookd-linux-x64'))})"
```
Expected: prints a 64-char hex (after `npm run build`).

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci: publish SHA256SUMS with release binaries"
```

---

## Task 12: Docs + acceptance-criteria verification

**Files:**
- Modify: `README.md` (document auto-sync + `cookd uninstall`)
- Modify: `SECURITY.md` (note the settings.json edit + downloaded binary + checksum)

- [ ] **Step 1: Document in README**

Add an "Auto-sync" section: what consent does, the exact settings.json edit, that stats then refresh at the end of every Claude session, and `cookd uninstall` to turn it off. State the ~50–90 MB one-time binary download and that it lives at `~/.cookd/bin/`.

- [ ] **Step 2: Update SECURITY.md**

Under the data/permissions inventory, add: cookd (on consent) writes a `SessionEnd` hook to `~/.claude/settings.json` (backup + add-only merge) and downloads a checksum-verified binary from the release host to `~/.cookd/bin/`; `cookd uninstall` reverses both. Reiterate `cookd sync` reads only the same structural stats governed by ADR-010.

- [ ] **Step 3: Run the whole suite + build**

Run: `npx vitest run && npm run build && npm run lint`
Expected: all green.

- [ ] **Step 4: Verify each ADR-011 Acceptance Criterion**

Walk ADR-011 §Acceptance Criteria and tick each against the code:
- `cookd sync` headless + reuses `syncWindowState` (Tasks 1–2). ✅
- os/arch binary downloaded + checksum-verified to `~/.cookd/bin/cookd`; offline defers (Tasks 5, 10). ✅
- `SessionEnd` hook via backup + merge + atomic; unparseable aborts; managed-policy detected (Task 6 — add a managed-policy detection note if `disableAllHooks`/`allowManagedHooksOnly` present: read + warn, still write user file). ✅
- `cookd uninstall` removes only cookd's block + binary (Tasks 6–8). ✅
- re-run on linked device syncs without press code (Task 9). ✅
- consent/uninstall reuse Ink + plain-TTY fallback; non-interactive never auto-installs (Task 10). ✅
- npm package still ships JS only — confirm `package.json` `files` unchanged (no binaries added). ✅
- R1 (access lapse) addressed-or-deferred — this plan defers per the ADR; note it in README as "syncs at session end". ✅

- [ ] **Step 5: Commit**

```bash
git add README.md SECURITY.md
git commit -m "docs: document auto-sync, consent, and uninstall"
```

---

## Open items carried from ADR-011 (not built here — tracked)
- **R1 — access lapse under SessionEnd-only.** Deferred. Follow-up option: also install a `SessionStart` hook to refresh `access_expires_at` at session start. Revisit if field reports show mid-session lockouts.
- **Heavy-scale re-architecture trigger.** If usage grows past the Modest envelope, switch `cookd sync` to read only the hook's `transcript_path` + move aggregation to the backend.
- **`topProject` folder-name leak** (ADR-010 known) — fix separately.
- **`demo-usage-sim` drift** — reconcile the `cookd-app` copy vs this published package.

## Self-Review notes
- **Spec coverage:** every ADR-011 acceptance criterion maps to a task (see Task 12 Step 4). ✅
- **Type consistency:** `runSyncOnce` returns `{ synced, creds }` (Task 1) and is consumed that way in Tasks 2/9; `releaseAssetName` (Task 3) feeds `downloadBinary`/`installFromBuffers` (Task 5); `parseSums` format (Task 4) matches `sha256sum` output (Task 11); `binaryPath()`/`claudeSettingsPath()` names are stable across Tasks 5–10. ✅
- **No placeholders:** all steps carry real code/tests/commands. The only intentional note is the unused `expected` line in Task 4 Step 1 (explicitly told to delete). ✅

---

## What already exists (reused, not rebuilt)
- `src/commands/watch.ts` `syncNow` — the full sync logic → extracted into `runSyncOnce` (Task 1). Reuse.
- `src/sync/client.ts` `syncWindowState` + `src/sync/queue.ts` — the durable outbound path. Reuse (no new POST path).
- `src/auth/credentials.ts` `loadCredentials`/`isLinked` — foundation for the re-init guard (Task 9). Reuse.
- `safeFetch` (`client.ts:7`) — proxy/TLS-aware fetch; the binary download should reuse it. Reuse.
- `src/ui/ink/*` + `src/ui/theme.ts` — consent-screen chrome (Task 10). Reuse.
- `.github/workflows/release.yml` — already builds the 5 binaries; Task 11 only adds `SHA256SUMS`. Extend.

## NOT in scope (considered, deferred)
- Per-turn (`Stop`) syncing — deferred; SessionStart+SessionEnd covers freshness + access.
- Transcript-only incremental reads + backend accumulation — deferred (Modest scale; full scan reused).
- Codex/Cursor adapters + triggers — deferred; `cookd sync` stays agent-neutral so they're additive.
- `topProject` folder-name privacy leak — tracked separately (ADR-010).
- `optionalDependencies` per-platform packages (A3) — deferred publish machinery; A1 download chosen.
- Automated `watch.ts` unit testing (chokidar + timers) — out of this repo's harness; manual verify in Task 12.
- `demo-usage-sim` reconciliation — flagged for a separate pass.

## Failure modes (per new codepath)
| Codepath | Realistic failure | Test? | Error handling? | User-visible? |
|---|---|---|---|---|
| `cookd sync` (hook) | Offline / backend down mid-POST | run.test (mocked) | try/catch swallows; data stays queued, flushes next SessionStart | silent by design (hook must not break Claude) — OK |
| `downloadBinary` | Release/SHA256SUMS missing or 404 | binary.test (mismatch path) | throws → Task 10 catches → "setup skipped" | clear message ✅ |
| `installCookdHooks` | Unparseable existing settings.json | settings.test | `SettingsError` aborts before any write | clear message ✅ |
| async SessionEnd sync | Killed on Claude exit before POST | — | queue persists; SessionStart flushes next session | none (recovered) — **was a critical gap, closed by D3** |
| concurrent SessionEnd fires | Racing SQLite writes | — | WAL + idempotent `usage-ingest` upserts | none — OK at Modest scale |

No remaining **critical gaps** (silent + untested + unhandled): the async-kill gap was the candidate; D3 (SessionStart flush) closes it.

## Worktree parallelization
| Lane | Tasks | Modules | Depends on |
|---|---|---|---|
| A | 3, 4, 5 | `src/hooks/{platform,checksum,binary}` | — |
| B | 6 | `src/hooks/settings` | — |
| C | 1, 2 | `src/sync/run`, `src/commands/sync`, `watch` | — |
| D | 11 | `.github/workflows` | — |
| E | 7, 8 | `src/hooks/install`, `src/commands/uninstall` | A + B |
| F | 9, 10 | `src/commands/init`, `src/ui/ink/Consent` | C + E |

Launch **A, B, C, D in parallel**. Then **E**. Then **F**. Task 12 last.
Conflict flags: Tasks 2 + 8 both edit `cli.ts` (coordinate the two `program.command` additions); Tasks 9 + 10 both edit `init.tsx` (sequential within Lane F).

## Implementation Tasks (review-derived)
- [ ] **T1 (P1)** — settings.ts — exec-form hook (`command: binaryPath, args:['sync']`). Surfaced by: Architecture Issue 1 (Windows path-with-spaces ship-blocker). Files: `src/hooks/settings.ts`, `test/hooks/settings.test.ts`. Verify: test asserts `args:['sync']`, no shell string.
- [ ] **T2 (P2)** — settings.ts — identify hook by command path, drop `_cookd`. Surfaced by: Architecture Issue 3. Files: `src/hooks/settings.ts` + test. Verify: remove works after a simulated field-strip.
- [ ] **T3 (P2)** — settings.ts + install.ts — install BOTH SessionStart + SessionEnd. Surfaced by: Architecture Issue 4 / R1. Files: `src/hooks/settings.ts`, `src/hooks/install.ts`, tests. Verify: both events carry a cookd entry; uninstall clears both.
- [ ] **T4 (P2, regression)** — watch.ts — regression coverage for the `runSyncOnce` extraction. Surfaced by: Test review (IRON RULE). Files: `test/sync/run.test.ts` + manual watch smoke in Task 12. Verify: `node dist/cli.js watch` still syncs.
- [ ] **T5 (P3)** — README — document release-coupling (auto-sync live from the shipping version). Surfaced by: Architecture Issue 2 / D4. Files: `README.md`.

---

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Codex Review | `/codex review` | Independent 2nd opinion | 0 | — | — |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | CLEAR (PLAN) | 4 issues, 0 critical gaps (async-kill closed by D3) |
| Design Review | `/plan-design-review` | UI/UX gaps | 1 | CLEAR | 6/10 → 9/10, 2 decisions, 4 deltas (DD1 fixed a broken exact-edit disclosure) |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **Scope:** complexity smell (12 files) reviewed → structure kept as-is (founder call); decomposition mirrors `adapters/*`.
- **Eng findings resolved:** D1 exec-form hook (Windows ship-blocker), D2 command-path identity, D3 SessionStart+SessionEnd (closes R1 + async-kill), D4 release-coupling documented. Tests added: watch regression, exec-form/args, both-hooks, non-interactive-no-install.
- **Design findings resolved:** DD1 faithful two-hook edit disclosure + ~60MB download disclosure (the consent was showing the wrong edit after the eng deltas — trust-critical), DD2 make the edit the most-legible element, DD3 humane deferred/error copy, DD4 uninstall copy. Decisions: faithful plain-language edit summary; `[Y/n]` default-yes.
- **UNRESOLVED:** none.
- **VERDICT:** ENG + DESIGN CLEARED — ready to implement. Run `/ship` when done (then `/chief-architect-verify` before merge, per the pipeline).
