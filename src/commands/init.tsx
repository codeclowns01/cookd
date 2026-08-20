import React, { useState, useEffect } from 'react';
import { render, Text } from 'ink';
import type { UsageEvent } from '../adapters/types.js';
import type { Credentials } from '../auth/credentials.js';
import { loadCredentials, saveCredentials } from '../auth/credentials.js';
import { deviceLinkStart, pollForLink, generateDeviceId } from '../auth/device-link.js';
import { detectAdapter } from '../adapters/registry.js';
import { ClaudeCodeAdapter } from '../adapters/claude-code/index.js';
import { computeWindow, WINDOW_MS } from '../adapters/claude-code/window.js';
import { computeWrapped, computeModelBreakdown, computeDailyStats, computeLifetimeStats, computeTonight } from '../adapters/claude-code/wrapped.js';
import { calibrate } from '../adapters/claude-code/calibrate.js';
import { saveCalibration } from '../adapters/claude-code/calibration-store.js';
import { syncWindowState, syncLifetimeStats, syncHistoricalStats } from '../sync/client.js';
import type { WindowSummary } from '../sync/events.js';
import type { SessionStats } from '../adapters/claude-code/transcript.js';
import { Ticker } from '../ui/ink/Ticker.js';
import { BoxBottom, BoxBlank, BoxDivider } from '../ui/ink/Box.js';
import { EditorialBlock } from '../ui/ink/EditorialBlock.js';
import { HeatGauge } from '../ui/ink/HeatGauge.js';
import { PressCode } from '../ui/ink/PressCode.js';
import { Barcode } from '../ui/ink/Barcode.js';
import chalk from 'chalk';
import { createInterface } from 'readline';
import { STAMP, MUT, FLAME, FAINT } from '../ui/theme.js';
import { formatTokens, formatDuration } from '../ui/helpers.js';
import {
  isAlreadyLinked, shouldOfferAutoSync, resolveRelink,
  type InitOutcome, type RelinkDecision,
} from './init-guard.js';
import { healthFromOutcome, relinkColorFor } from '../ui/ink/Relink.js';
import { runSyncOnce, type SyncOutcome } from '../sync/run.js';
import { installAutoSync } from '../hooks/install.js';
import { binaryPath } from '../hooks/binary.js';
import { consentLines, consentColorFor } from '../ui/ink/Consent.js';
import { hasCookdHook, claudeSettingsPath } from '../hooks/settings.js';

async function syncAfterLink(
  creds: Credentials,
  events: UsageEvent[],
  calResult: ReturnType<typeof calibrate>,
  today: string,
  sessionStats: SessionStats,
): Promise<void> {
  try {
    const win = computeWindow(events, calResult.cpLimit);
    const oldestEvent = win.events[0];
    const initRatio = calResult.cpLimit ? win.ratio : 0;
    const initStatus: WindowSummary['status'] =
      !calResult.cpLimit || initRatio < 0.1 ? 'idle'
      : initRatio >= 0.95 ? 'cookd'
      : 'cooking';
    const summary: WindowSummary = {
      status: initStatus,
      usedTokens: win.weightedTokens,
      limitTokens: calResult.cpLimit,
      pctUsed: calResult.cpLimit ? initRatio * 100 : null,
      windowStart: win.windowStart.toISOString(),
      resetsAt: oldestEvent ? new Date(oldestEvent.ts.getTime() + WINDOW_MS).toISOString() : null,
      plan: null,
      calibrationConfidence: calResult.confidence,
      modelBreakdown: Object.fromEntries(computeModelBreakdown(win.events).map(s => [s.model, s.cpTokens])),
      dailyStats: computeDailyStats(events, today, calResult.cpLimit ? win.ratio * 100 : 0, sessionStats),
      tonight: computeTonight(win.events, sessionStats),
    };
    await syncWindowState(creds, summary);
  } catch { /* non-fatal on first link */ }

  try {
    const lifetimeStats = computeLifetimeStats(events);
    await syncLifetimeStats(creds, lifetimeStats);
    await saveCredentials({ ...creds, lastWrappedSync: new Date().toISOString() });
  } catch { /* non-fatal — retried on next watch startup */ }

  try {
    const allDates = [...new Set(
      events.filter(e => !e.limitResetAt).map(e => e.ts.toLocaleDateString('en-CA'))
    )].sort();
    const historyDates = allDates.filter(d => d !== today);
    if (historyDates.length > 0) {
      const historyStats = historyDates.map(date => {
        const raw = computeDailyStats(events, date, 0);
        const hasRLHit = events.some(e => !!e.limitResetAt && e.ts.toLocaleDateString('en-CA') === date);
        const peakPct = hasRLHit ? 100
          : calResult.cpLimit ? Math.min(100, Math.round(raw.totalCp / calResult.cpLimit * 100)) : 0;
        return { ...raw, peakPctUsed: peakPct };
      });
      await syncHistoricalStats(creds, historyStats);
    }
  } catch { /* non-fatal — history can be re-synced on next init */ }
}

type InitState =
  | 'cold-open'
  | 'reading'
  | 'no-data'
  | 'field-notes'
  | 'printing'
  | 'network-error'
  | 'press-code'
  | 'expired'
  | 'stopped-waiting'
  | 'success'
  | 'resync';

function spinnerFrame(tick: number): string {
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  return frames[tick % frames.length];
}

/** How long a RELINK waits for redemption. A returning user is watching their own
 *  terminal; the 10-minute default is for a first-time link that needs app-install time. */
const RELINK_POLL_MS = 120_000;

/**
 * Everything that must be settled BEFORE the UI starts.
 *
 * The revoked-token confirmation needs stdin, and Ink owns stdin once rendered —
 * the established pattern (`offerAutoSync`) only prompts after unmount. Deciding
 * here keeps one confirmation implementation for both flows instead of two, and
 * means a declined confirm mints nothing at all.
 */
export interface Preflight {
  creds: Credentials | null;
  decision: RelinkDecision;
  /** User declined to start over — do nothing further. */
  aborted: boolean;
}

export async function preflight(
  confirm: (lines: string[]) => Promise<boolean>,
): Promise<Preflight> {
  const existing = await loadCredentials();
  if (!isAlreadyLinked(existing)) {
    return {
      creds: existing,
      decision: resolveRelink({ alreadyLinked: false, health: 'unknown', outcome: null, handle: null }),
      aborted: false,
    };
  }

  // force: true — a recovery attempt must PROVE the token alive or dead. Both
  // gates return before any HTTP, so without this the warning could never fire
  // for the hook-installed population, which is now the default one (E1).
  let outcome: SyncOutcome = 'network';
  let creds = existing!;
  try {
    const res = await runSyncOnce(existing!, { force: true });
    outcome = res.outcome;
    creds = res.creds; // may carry a freshly-written cooked-event watermark
  } catch { /* non-fatal — queued, retries next sync */ }

  const decision = resolveRelink({
    alreadyLinked: true,
    health: healthFromOutcome(outcome),
    outcome,
    handle: creds.handle,
  });

  if (decision.requiresConfirm && !(await confirm(decision.bannerLines))) {
    return { creds, decision, aborted: true };
  }
  return { creds, decision, aborted: false };
}

interface InitAppProps {
  onDone: (outcome: InitOutcome) => void;
  pre: Preflight;
}

function InitApp({ onDone, pre }: InitAppProps): React.ReactElement {
  const [state, setState] = useState<InitState>('cold-open');
  const [tick, setTick] = useState(0);
  const [countdown, setCountdown] = useState(600);
  const [pressCode, setPressCode] = useState('');
  const [wrapped, setWrapped] = useState<ReturnType<typeof computeWrapped> | null>(null);
  const [error, setError] = useState('');
  const [linkedHandle, setLinkedHandle] = useState('');
  const [linkedDeviceId, setLinkedDeviceId] = useState('');
  const [wasLinked, setWasLinked] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => setTick(t => t + 1), 100);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (state === 'press-code') {
      const timer = setInterval(() => {
        setCountdown(c => {
          if (c <= 1) { clearInterval(timer); setState('expired'); return 0; }
          return c - 1;
        });
      }, 1000);
      return () => clearInterval(timer);
    }
  }, [state]);

  useEffect(() => {
    run();
  }, []);

  async function run() {
    setState('reading');
    await new Promise(r => setTimeout(r, 800));

    const existing = pre.creds;
    const relinking = isAlreadyLinked(existing);
    const decision = pre.decision;

    // An already-linked device re-syncs first — that convenience is kept. What
    // changed: it no longer STOPS there.
    //
    // Defect B3. The old guard returned right here, so a machine holding any
    // device token could never obtain a press code again. That is fine while the
    // token still points at the account the user is signed into — and a hard
    // block the moment it does not. A tester who installs the app fresh and signs
    // into a NEW account has a laptop still validly linked to the OLD one: the
    // server accepts every push, the app sees no device, and the one action that
    // would fix it (present a press code) was unreachable. No probe can detect
    // that case, because nothing about it is broken from the server's side — the
    // token is live, it is just pointed elsewhere. So the code is always offered
    // and the user decides whether they need it.
    // The resync already ran in preflight() — its result is in `decision`.
    if (relinking) {
      setWasLinked(true);
      setLinkedHandle(existing!.handle);
      setState('resync');
      await new Promise(r => setTimeout(r, 900));
    }

    const adapter = await detectAdapter();
    if (!adapter && !relinking) {
      setState('no-data');
      setTimeout(() => onDone('other'), 3000);
      return;
    }

    setState('field-notes');
    // Field notes are decoration on the relink path; the press code is the point.
    // A relinking device with no readable history still gets its code.
    let events: UsageEvent[] = [];
    if (adapter) {
      try {
        events = await adapter.events();
      } catch {
        if (!relinking) {
          setState('network-error');
          setTimeout(() => onDone('other'), 3000);
          return;
        }
      }
    }
    const ccAdapter = adapter instanceof ClaudeCodeAdapter ? adapter : null;
    const sessionStats = ccAdapter?.getSessionStats() ?? { prompts: 0, yoloPrompts: 0, toolCounts: {}, toolErrors: 0 };

    if (events.length === 0 && !relinking) {
      setState('no-data');
      setTimeout(() => onDone('other'), 3000);
      return;
    }

    const deviceId = existing?.deviceId ?? generateDeviceId();
    const calResult = calibrate(events);
    if (events.length > 0) {
      saveCalibration({
        cpLimit: calResult.cpLimit,
        confidence: calResult.confidence,
        calibratedAt: new Date().toISOString(),
      });
      setWrapped(computeWrapped(events, 'you', calResult.cpLimit));
    }

    setState('printing');
    await new Promise(r => setTimeout(r, 1200));

    let linkSession;
    try {
      linkSession = await deviceLinkStart(deviceId, existing?.deviceToken);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'unknown error');
      setState('network-error');
      setTimeout(() => onDone('other'), 5000);
      return;
    }

    setPressCode(linkSession.pressCode);
    setCountdown(Math.floor((new Date(linkSession.expiresAt).getTime() - Date.now()) / 1000));
    setState('press-code');

    // Short leash on a relink (T4/DD): a returning user is watching their own
    // terminal. Ten minutes here is what made Ctrl-C the rational choice, and
    // Ctrl-C skips offerAutoSync — reintroducing defect B2 for everyone sensible.
    const creds = await pollForLink(
      deviceId, linkSession.sessionId, () => {}, existing,
      3000, relinking ? RELINK_POLL_MS : undefined,
    );
    if (!creds) {
      // A relink gives up after RELINK_POLL_MS, but the code lives ~10 minutes
      // server-side — saying "expired" would be a lie, and on a reauth the
      // laptop does not need to witness the redemption anyway (no new token is
      // issued; it keeps the one it has).
      setState(relinking ? 'stopped-waiting' : 'expired');
      // An already-linked device that ignored the code still resynced, and must
      // still reach offerAutoSync — that is the population the hook exists for
      // (defect B2). Letting the code expire is the normal outcome for someone
      // who only wanted a refresh, so it cannot cost them the offer.
      setTimeout(() => onDone(relinking ? 'resynced' : 'other'), 3000);
      return;
    }

    await saveCredentials(creds);

    const today = new Date().toLocaleDateString('en-CA');
    if (events.length > 0) {
      await syncAfterLink(creds, events, calResult, today, sessionStats);
    }

    setLinkedHandle(creds.handle);
    setLinkedDeviceId(creds.deviceId);
    setState('success');
    setTimeout(() => onDone('linked'), 3000);
  }

  const ratio = wrapped?.window.ratio ?? 0;
  const handle = linkedHandle || wrapped?.handle || 'you';
  const mins = Math.floor(countdown / 60).toString().padStart(2, '0');
  const secs = (countdown % 60).toString().padStart(2, '0');

  const headline = ratio >= 0.9
    ? ['you did it again,', 'chef.']
    : ratio >= 0.5
    ? ['halfway through', 'the window.']
    : ['just getting', 'warmed up.'];

  const aside = wrapped
    ? `${formatTokens(wrapped.window.weightedTokens)} tokens in ${formatDuration(wrapped.window.msUntilExpiry)}. you weren't building. you were cooking.`
    : 'reading your field notes…';

  const receiptLines = wrapped?.receiptLines ?? [];

  return (
    <>
      <Ticker state={state} handle={handle} tokenSummary={wrapped ? formatTokens(wrapped.window.weightedTokens) : ''} />
      <Text> </Text>

      {(state === 'cold-open' || state === 'reading') && (
        <>
          <Text>{chalk.hex(FAINT)('  ' + spinnerFrame(tick) + '  reading your field notes…')}</Text>
        </>
      )}

      {(state === 'field-notes' || state === 'printing' || state === 'press-code' || state === 'success') && wrapped && (
        <>
          <EditorialBlock
            handle={handle}
            headline={headline}
            aside={aside}
            receiptLines={receiptLines}
          />
          <BoxDivider />
          <BoxBlank />
          <HeatGauge ratio={ratio} />
          <BoxBlank />
        </>
      )}

      {state === 'printing' && (
        <>
          <BoxDivider />
          <Text>{'  ' + chalk.hex(FAINT)(spinnerFrame(tick) + '  filing your notes with the press…')}</Text>
          <BoxBottom />
        </>
      )}

      {state === 'press-code' && (
        <>
          <BoxDivider />
          <BoxBlank />
          {wasLinked && (
            <>
              {pre.decision.bannerLines.map((line, i) => (
                <Text key={i}>{'  ' + (line ? chalk.hex(relinkColorFor(line, i))(line) : '')}</Text>
              ))}
              <BoxBlank />
            </>
          )}
          <PressCode code={pressCode} />
          <BoxBlank />
          <Text>
            {'  '}
            {chalk.hex(FAINT)(spinnerFrame(tick))}
            {'  '}
            {chalk.hex(STAMP).bold('EXPIRES IN')}
            {'  '}
            {chalk.hex(FLAME).bold(`${mins}:${secs}`)}
            {'  '}
            {chalk.hex(MUT).italic('— waiting for credentials to be presented…')}
          </Text>
          <BoxBlank />
          <BoxBottom />
        </>
      )}

      {state === 'success' && (
        <>
          <BoxDivider />
          <BoxBlank />
          <Barcode
            handle={linkedHandle}
            deviceId={linkedDeviceId}
            linkedAt={new Date()}
            serialNumber={1}
          />
          <BoxBlank />
          <BoxBottom />
        </>
      )}

      {state === 'no-data' && (
        <>
          <Text>{'  ' + chalk.hex(FAINT)('no claude code session history found.')}</Text>
          <Text>{'  ' + chalk.hex(MUT).italic('— start a session, then come back.')}</Text>
        </>
      )}

      {state === 'resync' && (
        <>
          <Text>{'  ' + chalk.hex(FAINT)(spinnerFrame(tick) + '  re-syncing your latest usage…')}</Text>
          {/* Report what actually happened. The Ink path used to say nothing at
              all here while the plain path claimed "synced." — the drift that
              made a shared decision function non-negotiable. */}
          {pre.decision.resyncLine && (
            <Text>{'  ' + chalk.hex(MUT).italic('— ' + pre.decision.resyncLine)}</Text>
          )}
        </>
      )}

      {state === 'network-error' && (
        <>
          <Text>{'  ' + chalk.hex(FLAME).bold('transmission failure.')}</Text>
          <Text>{'  ' + chalk.hex(FAINT)(error || 'check your connection and try again.')}</Text>
        </>
      )}

      {state === 'stopped-waiting' && (
        <>
          <Text>{'  ' + chalk.hex(FAINT)('not waiting any longer — but your code is still good.')}</Text>
          <Text>{'  ' + chalk.hex(MUT).italic('— enter it in the app; this laptop doesn’t need to be watching.')}</Text>
        </>
      )}

      {state === 'expired' && (
        <>
          <Text>{'  ' + chalk.hex(FAINT)('press code expired.')}</Text>
          <Text>{'  ' + chalk.hex(MUT).italic('— run cookd init again when you\'re ready.')}</Text>
        </>
      )}

      <Text> </Text>
    </>
  );
}

function humaneAutoSyncError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/no prebuilt/i.test(msg)) return 'auto-sync isn’t available for your platform yet — re-run cookd anytime.';
  if (/download failed|checksums fetch failed|fetch failed|ENOTFOUND|ETIMEDOUT|ECONNREFUSED/i.test(msg))
    return 'couldn’t reach the download server — auto-sync will finish next time you run cookd.';
  if (/not valid JSON/i.test(msg)) return 'your ~/.claude/settings.json isn’t valid JSON — fix it, then re-run cookd.';
  if (/allowManagedHooks|disableAllHooks|managed/i.test(msg)) return 'your organization blocks Claude hooks — auto-sync isn’t available here.';
  return 'auto-sync setup skipped - re-run cookd anytime to finish.';
}

/**
 * Default NO (design delta DD5).
 *
 * `askYesNoDefaultYes` exists for the auto-sync offer, where a default-yes bias
 * is right because the action is reversible (`cookd uninstall`). Reusing it for
 * an irreversible one would make pressing Enter abandon an account. Separate
 * helper, separate default, `[y/N]` in the prompt.
 */
async function askYesNoDefaultNo(): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await new Promise<string>(resolve => rl.question('', resolve));
    return /^\s*y/i.test(answer);
  } finally {
    rl.close();
  }
}

/** The revoked-token confirmation. Non-interactive NEVER auto-confirms. */
export async function confirmStartOver(lines: string[]): Promise<boolean> {
  const p = (s: string) => process.stdout.write(s + '\n');
  p('');
  lines.forEach((l, i) => p('  ' + chalk.hex(relinkColorFor(l, i))(l)));
  if (!process.stdin.isTTY) {
    p(chalk.hex(FAINT)('  run this in a terminal to continue.'));
    return false;
  }
  p('');
  p('  ' + chalk.hex(FLAME).bold('continue and start over?  [y/N]'));
  return askYesNoDefaultNo();
}

async function askYesNoDefaultYes(): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await new Promise<string>(resolve => rl.question('', resolve));
    return !/^\s*n/i.test(answer);
  } finally {
    rl.close();
  }
}

/** Offer to install auto-sync (consented). Shown after a first link, in both the Ink
 *  and plain flows. Non-interactive contexts never install. */
export async function offerAutoSync(version: string, p: (s: string) => void): Promise<void> {
  // Already wired? Then the user consented to this edit once already; asking
  // again on every run reads as if something failed. An unparseable
  // settings.json throws here — that must fall through to OFFERING, not crash.
  try {
    if (hasCookdHook(claudeSettingsPath())) return;
  } catch { /* unreadable settings — offer anyway, installAutoSync reports properly */ }
  if (!process.stdin.isTTY) {
    p(chalk.hex(FAINT)('  auto-sync off — re-run cookd anytime to refresh.'));
    return;
  }
  p('');
  consentLines(binaryPath()).forEach((line, i) => p('  ' + chalk.hex(consentColorFor(line, i))(line)));
  p('');
  p('  ' + chalk.hex(FLAME).bold('add this line? [Y/n]'));
  if (!(await askYesNoDefaultYes())) {
    p(chalk.hex(FAINT)('  auto-sync off — re-run cookd anytime to refresh.'));
    return;
  }
  p(chalk.hex(FAINT)('  setting up auto-sync…'));
  try {
    await installAutoSync(version);
    p(chalk.green.bold('  auto-sync on.') + chalk.hex(FAINT)(' stats now refresh at every Claude session.'));
  } catch (e) {
    p(chalk.hex(FLAME)('  ' + humaneAutoSyncError(e)));
  }
}

async function runInitPlain(version: string, pre: Preflight): Promise<void> {
  const p = (msg: string) => process.stdout.write(msg + '\n');

  p('');
  p(chalk.bold('  cookd / field reporter'));
  p(chalk.hex(FAINT)('  reading your field notes…'));

  const existing = pre.creds;
  const relinking = isAlreadyLinked(existing);

  // The re-sync already ran in preflight(); report its real result rather than
  // asserting success. This path also used to `return` here, which meant the
  // non-TTY flow never reached offerAutoSync either.
  if (relinking && pre.decision.resyncLine) {
    p(chalk.hex(FAINT)('  re-syncing your latest usage…'));
    p(chalk.hex(MUT)('  — ' + pre.decision.resyncLine));
  }

  const adapter = await detectAdapter();
  if (!adapter && !relinking) {
    p(chalk.hex(FAINT)('  no claude code session history found.'));
    p(chalk.hex(MUT)('  — start a session, then come back.'));
    return;
  }

  let events: UsageEvent[] = [];
  if (adapter) {
    try {
      events = await adapter.events();
    } catch {
      if (!relinking) {
        p(chalk.hex(FLAME).bold('  transmission failure.'));
        p(chalk.hex(FAINT)('  check your connection and try again.'));
        return;
      }
    }
  }
  const ccAdapter = adapter instanceof ClaudeCodeAdapter ? adapter : null;
  const sessionStats = ccAdapter?.getSessionStats() ?? { prompts: 0, yoloPrompts: 0, toolCounts: {}, toolErrors: 0 };

  if (events.length === 0 && !relinking) {
    p(chalk.hex(FAINT)('  no claude code session history found.'));
    p(chalk.hex(MUT)('  — start a session, then come back.'));
    return;
  }

  const deviceId = existing?.deviceId ?? generateDeviceId();
  const calResult = calibrate(events);
  if (events.length > 0) {
    saveCalibration({ cpLimit: calResult.cpLimit, confidence: calResult.confidence, calibratedAt: new Date().toISOString() });
    const stats = computeWrapped(events, 'you', calResult.cpLimit);
    p('');
    p(chalk.bold(`  ${formatTokens(stats.window.weightedTokens)} tokens — ${Math.round(stats.window.ratio * 100)}% of window`));
  }
  p(chalk.hex(FAINT)('  filing your notes with the press…'));

  let linkSession;
  try {
    linkSession = await deviceLinkStart(deviceId, existing?.deviceToken);
  } catch (e) {
    p(chalk.hex(FLAME).bold('  transmission failure.'));
    p(chalk.hex(FAINT)('  ' + (e instanceof Error ? e.message : 'unknown error') + ' — check your connection.'));
    return;
  }

  p('');
  if (relinking) {
    pre.decision.bannerLines.forEach((line, i) =>
      p('  ' + (line ? chalk.hex(relinkColorFor(line, i))(line) : '')));
    p('');
  }
  p(chalk.hex(STAMP).bold('  YOUR PRESS CODE'));
  p('');
  p('  ' + chalk.hex(FLAME).bold(linkSession.pressCode));
  p('');
  p(chalk.hex(FAINT)('  enter this code at cookd.codeclowns.com to link your device'));
  p(chalk.hex(FAINT)(`  expires at ${new Date(linkSession.expiresAt).toLocaleTimeString()}`));
  p('');
  p(chalk.hex(MUT)('  waiting for credentials to be presented…'));

  // A piped / CI / hook-context relink must never block: nobody is there to
  // redeem the code, and the caller is often waiting on our exit. Print it and
  // go. A FRESH link still waits — that user genuinely needs time to install
  // the app, and there is nothing useful to return to them without it.
  if (relinking && !process.stdin.isTTY) {
    p(chalk.hex(FAINT)('  (not a terminal — not waiting. run it again here when you’ve entered the code.)'));
    return;
  }

  const creds = await pollForLink(
    deviceId, linkSession.sessionId, () => {}, existing,
    3000, relinking ? RELINK_POLL_MS : undefined,
  );
  if (!creds) {
    if (relinking) {
      p(chalk.hex(FAINT)('  not waiting any longer — but your code is still good.'));
      p(chalk.hex(MUT)('  — enter it in the app; this laptop doesn’t need to be watching.'));
    } else {
      p(chalk.hex(FAINT)('  press code expired.'));
      p(chalk.hex(MUT)("  — run cookd init again when you're ready."));
    }
    // An expired code on a relink is the normal "I only wanted a refresh"
    // outcome — it must not cost the machine the auto-sync offer (defect B2).
    if (relinking) await offerAutoSync(version, p);
    return;
  }

  await saveCredentials(creds);
  p('');
  p(chalk.green.bold('  linked.'));
  p(chalk.hex(FAINT)(`  @${creds.handle} / ${creds.deviceId}`));
  p('');

  const today = new Date().toLocaleDateString('en-CA');
  if (events.length > 0) {
    await syncAfterLink(creds, events, calResult, today, sessionStats);
  }

  await offerAutoSync(version, p);
}

export async function runInit(version: string): Promise<void> {
  // Runs before either renderer: the confirmation needs stdin, which Ink takes
  // over once mounted. A declined confirm mints no code and touches nothing.
  const pre = await preflight(confirmStartOver);
  if (pre.aborted) {
    process.stdout.write(chalk.hex(FAINT)('\n  nothing changed. your old account is untouched.\n\n'));
    return;
  }

  if (!process.stdout.isTTY) {
    await runInitPlain(version, pre);
    return;
  }
  try {
    const outcome = await new Promise<InitOutcome>(resolve => {
      const { unmount } = render(<InitApp pre={pre} onDone={(o) => { unmount(); resolve(o); }} />);
    });
    if (shouldOfferAutoSync(outcome)) {
      await offerAutoSync(version, (s) => process.stdout.write(s + '\n'));
    }
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'EIO' || code === 'EBUSY' || code === 'EPERM') {
      await runInitPlain(version, pre);
    } else {
      throw e;
    }
  }
}
