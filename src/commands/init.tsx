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
import { STAMP, MUT, FLAME, FAINT } from '../ui/theme.js';
import { formatTokens, formatDuration } from '../ui/helpers.js';

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
  | 'success'
  | 'already-linked';

function spinnerFrame(tick: number): string {
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  return frames[tick % frames.length];
}

interface InitAppProps {
  onDone: () => void;
}

function InitApp({ onDone }: InitAppProps): React.ReactElement {
  const [state, setState] = useState<InitState>('cold-open');
  const [tick, setTick] = useState(0);
  const [countdown, setCountdown] = useState(600);
  const [pressCode, setPressCode] = useState('');
  const [wrapped, setWrapped] = useState<ReturnType<typeof computeWrapped> | null>(null);
  const [error, setError] = useState('');
  const [linkedHandle, setLinkedHandle] = useState('');
  const [linkedDeviceId, setLinkedDeviceId] = useState('');

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

    const existing = await loadCredentials();

    const adapter = await detectAdapter();
    if (!adapter) {
      setState('no-data');
      setTimeout(onDone, 3000);
      return;
    }

    setState('field-notes');
    let events;
    try {
      events = await adapter.events();
    } catch {
      setState('network-error');
      setTimeout(onDone, 3000);
      return;
    }
    const ccAdapter = adapter instanceof ClaudeCodeAdapter ? adapter : null;
    const sessionStats = ccAdapter?.getSessionStats() ?? { prompts: 0, yoloPrompts: 0, toolCounts: {}, toolErrors: 0 };

    if (events.length === 0) {
      setState('no-data');
      setTimeout(onDone, 3000);
      return;
    }

    const deviceId = existing?.deviceId ?? generateDeviceId();
    const calResult = calibrate(events);
    saveCalibration({
      cpLimit: calResult.cpLimit,
      confidence: calResult.confidence,
      calibratedAt: new Date().toISOString(),
    });
    const stats = computeWrapped(events, 'you', calResult.cpLimit);
    setWrapped(stats);

    setState('printing');
    await new Promise(r => setTimeout(r, 1200));

    let linkSession;
    try {
      linkSession = await deviceLinkStart(deviceId, existing?.deviceToken);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'unknown error');
      setState('network-error');
      setTimeout(onDone, 5000);
      return;
    }

    setPressCode(linkSession.pressCode);
    setCountdown(Math.floor((new Date(linkSession.expiresAt).getTime() - Date.now()) / 1000));
    setState('press-code');

    const creds = await pollForLink(deviceId, linkSession.sessionId, () => {}, existing?.deviceToken);
    if (!creds) {
      setState('expired');
      setTimeout(onDone, 3000);
      return;
    }

    await saveCredentials(creds);

    const today = new Date().toLocaleDateString('en-CA');
    await syncAfterLink(creds, events, calResult, today, sessionStats);

    setLinkedHandle(creds.handle);
    setLinkedDeviceId(creds.deviceId);
    setState('success');
    setTimeout(onDone, 5000);
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

      {state === 'already-linked' && (
        <>
          <Text>{'  ' + chalk.hex(STAMP).bold(`@${linkedHandle.toUpperCase()} already on record.`)}</Text>
          <Text>{'  ' + chalk.hex(FAINT)(linkedDeviceId)}</Text>
        </>
      )}

      {state === 'network-error' && (
        <>
          <Text>{'  ' + chalk.hex(FLAME).bold('transmission failure.')}</Text>
          <Text>{'  ' + chalk.hex(FAINT)(error || 'check your connection and try again.')}</Text>
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

async function runInitPlain(): Promise<void> {
  const p = (msg: string) => process.stdout.write(msg + '\n');

  p('');
  p(chalk.bold('  cookd / field reporter'));
  p(chalk.hex(FAINT)('  reading your field notes…'));

  const existing = await loadCredentials();
  const adapter = await detectAdapter();
  if (!adapter) {
    p(chalk.hex(FAINT)('  no claude code session history found.'));
    p(chalk.hex(MUT)('  — start a session, then come back.'));
    return;
  }

  let events: UsageEvent[];
  try {
    events = await adapter.events();
  } catch {
    p(chalk.hex(FLAME).bold('  transmission failure.'));
    p(chalk.hex(FAINT)('  check your connection and try again.'));
    return;
  }
  const ccAdapter = adapter instanceof ClaudeCodeAdapter ? adapter : null;
  const sessionStats = ccAdapter?.getSessionStats() ?? { prompts: 0, yoloPrompts: 0, toolCounts: {}, toolErrors: 0 };

  if (events.length === 0) {
    p(chalk.hex(FAINT)('  no claude code session history found.'));
    p(chalk.hex(MUT)('  — start a session, then come back.'));
    return;
  }

  const deviceId = existing?.deviceId ?? generateDeviceId();
  const calResult = calibrate(events);
  saveCalibration({ cpLimit: calResult.cpLimit, confidence: calResult.confidence, calibratedAt: new Date().toISOString() });

  const stats = computeWrapped(events, 'you', calResult.cpLimit);
  const ratio = stats.window.ratio;
  p('');
  p(chalk.bold(`  ${formatTokens(stats.window.weightedTokens)} tokens — ${Math.round(ratio * 100)}% of window`));
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
  p(chalk.hex(STAMP).bold('  YOUR PRESS CODE'));
  p('');
  p('  ' + chalk.hex(FLAME).bold(linkSession.pressCode));
  p('');
  p(chalk.hex(FAINT)('  enter this code at cookd.codeclowns.com to link your device'));
  p(chalk.hex(FAINT)(`  expires at ${new Date(linkSession.expiresAt).toLocaleTimeString()}`));
  p('');
  p(chalk.hex(MUT)('  waiting for credentials to be presented…'));

  const creds = await pollForLink(deviceId, linkSession.sessionId, () => {}, existing?.deviceToken);
  if (!creds) {
    p(chalk.hex(FAINT)('  press code expired.'));
    p(chalk.hex(MUT)("  — run cookd init again when you're ready."));
    return;
  }

  await saveCredentials(creds);
  p('');
  p(chalk.green.bold('  linked.'));
  p(chalk.hex(FAINT)(`  @${creds.handle} / ${creds.deviceId}`));
  p('');

  const today = new Date().toLocaleDateString('en-CA');
  await syncAfterLink(creds, events, calResult, today, sessionStats);
}

export async function runInit(): Promise<void> {
  if (!process.stdout.isTTY) {
    await runInitPlain();
    return;
  }
  try {
    await new Promise<void>(resolve => {
      const { unmount } = render(<InitApp onDone={() => { unmount(); resolve(); }} />);
    });
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'EIO' || code === 'EBUSY' || code === 'EPERM') {
      await runInitPlain();
    } else {
      throw e;
    }
  }
}
