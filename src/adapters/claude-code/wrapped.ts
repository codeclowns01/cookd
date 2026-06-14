import type { UsageEvent } from '../types.js';
import { computeWeightedTokens, computeWindow, TOKEN_WEIGHTS, type WindowStats } from './window.js';
import { formatTokens, formatDuration } from '../../ui/helpers.js';
import type { ModelSegment, DailyStats, LifetimeStats, Tonight } from '../../sync/events.js';
import type { SessionStats } from './transcript.js';

export interface WrappedStats {
  handle: string;
  window: WindowStats;
  topModel: string;
  sessionCount: number;
  avgSessionMs: number;
  receiptLines: Array<{ label: string; value: string }>;
}

export function computeWrapped(events: UsageEvent[], handle: string, limit?: number | null): WrappedStats {
  const window = computeWindow(events, limit);

  const modelCounts = new Map<string, number>();
  for (const e of window.events) {
    modelCounts.set(e.model, (modelCounts.get(e.model) ?? 0) + computeWeightedTokens(e));
  }
  const topModel = [...modelCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'unknown';

  const sessionGapMs = 30 * 60 * 1000;
  let sessionCount = window.events.length > 0 ? 1 : 0;
  let totalSessionMs = 0;
  let sessionStart = window.events[0]?.ts.getTime() ?? 0;
  let prev = window.events[0]?.ts.getTime() ?? 0;

  for (let i = 1; i < window.events.length; i++) {
    const cur = window.events[i].ts.getTime();
    if (cur - prev > sessionGapMs) {
      totalSessionMs += prev - sessionStart;
      sessionCount++;
      sessionStart = cur;
    }
    prev = cur;
  }
  if (window.events.length > 0) totalSessionMs += prev - sessionStart;

  const avgSessionMs = sessionCount > 0 ? totalSessionMs / sessionCount : 0;

  const receiptLines = [
    { label: 'WEIGHTED TOKENS',   value: formatTokens(window.weightedTokens) },
    ...(limit != null ? [{ label: 'LIMIT', value: formatTokens(limit) }] : []),
    { label: 'INPUT',             value: `${formatTokens(window.inputTokens)} × ${TOKEN_WEIGHTS.input}` },
    { label: 'OUTPUT',            value: `${formatTokens(window.outputTokens)} × ${TOKEN_WEIGHTS.output}` },
    { label: 'CACHE WRITE',       value: `${formatTokens(window.cacheCreationTokens)} × ${TOKEN_WEIGHTS.cacheCreation5m}` },
    { label: 'CACHE READ',        value: `${formatTokens(window.cacheReadTokens)} × ${TOKEN_WEIGHTS.cacheRead}` },
    { label: 'TOP MODEL',         value: topModel },
    { label: 'SESSIONS',          value: String(sessionCount) },
    { label: 'AVG SESSION',       value: formatDuration(avgSessionMs) },
    { label: 'WINDOW EXPIRES IN', value: formatDuration(window.msUntilExpiry) },
  ];

  return { handle, window, topModel, sessionCount, avgSessionMs, receiptLines };
}

function toLocalDate(d: Date): string {
  return d.toLocaleDateString('en-CA');
}

function countSessions(events: UsageEvent[]): number {
  if (events.length === 0) return 0;
  const withId = events.filter(e => e.sessionId);
  if (withId.length > 0) {
    return new Set(withId.map(e => e.sessionId)).size;
  }
  const sorted = [...events].sort((a, b) => a.ts.getTime() - b.ts.getTime());
  let count = 1;
  const GAP_MS = 30 * 60 * 1000;
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].ts.getTime() - sorted[i - 1].ts.getTime() > GAP_MS) count++;
  }
  return count;
}

export function computeModelBreakdown(windowEvents: UsageEvent[]): ModelSegment[] {
  const modelCp = new Map<string, number>();
  let total = 0;
  for (const e of windowEvents) {
    if (e.limitResetAt) continue;
    const cp = computeWeightedTokens(e);
    modelCp.set(e.model, (modelCp.get(e.model) ?? 0) + cp);
    total += cp;
  }
  return [...modelCp.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([model, cpTokens]) => ({
      model,
      cpTokens,
      pctOfWindow: total > 0 ? Math.round((cpTokens / total) * 100) : 0,
    }));
}

export function computeDailyStats(allEvents: UsageEvent[], localDate: string, peakPctUsed = 0, sessionStats?: SessionStats): DailyStats {
  const dayEvents = allEvents.filter(e => toLocalDate(e.ts) === localDate);
  const usageEvents = dayEvents.filter(e => !e.limitResetAt);
  const limitHitCount = dayEvents.filter(e => e.limitResetAt).length;

  let totalCp = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheCreationTokens = 0;
  let cacheReadTokens = 0;
  const modelBreakdown: Record<string, number> = {};
  const hourCp = new Map<number, number>();

  for (const e of usageEvents) {
    const cp = computeWeightedTokens(e);
    totalCp += cp;
    inputTokens += e.inputTokens;
    outputTokens += e.outputTokens;
    cacheCreationTokens += e.cacheCreationTokens + e.cacheCreation1hTokens;
    cacheReadTokens += e.cacheReadTokens;
    modelBreakdown[e.model] = (modelBreakdown[e.model] ?? 0) + cp;
    hourCp.set(e.ts.getHours(), (hourCp.get(e.ts.getHours()) ?? 0) + cp);
  }

  const timestamps = dayEvents.map(e => e.ts.getTime());
  const firstSessionAt = timestamps.length > 0 ? Math.min(...timestamps) : null;
  const lastActivityAt = timestamps.length > 0 ? Math.max(...timestamps) : null;

  const peakHour = hourCp.size > 0 ? [...hourCp.entries()].sort((a, b) => b[1] - a[1])[0][0] : undefined;
  const toolCalls = sessionStats
    ? Object.values(sessionStats.toolCounts).reduce((s, n) => s + n, 0)
    : undefined;

  return {
    localDate,
    totalCp,
    inputTokens,
    outputTokens,
    cacheCreationTokens,
    cacheReadTokens,
    sessionCount: countSessions(usageEvents),
    limitHitCount,
    peakPctUsed: Math.min(100, Math.round(peakPctUsed)),
    modelBreakdown,
    firstSessionAt,
    lastActivityAt,
    prompts: sessionStats?.prompts,
    toolCalls,
    peakHour,
  };
}

export function computeTonight(windowEvents: UsageEvent[], sessionStats: SessionStats): Tonight {
  const usageEvents = windowEvents.filter(e => !e.limitResetAt);

  const outputTokens = usageEvents.reduce((s, e) => s + e.outputTokens, 0);

  const sessionIds = new Set(usageEvents.filter(e => e.sessionId).map(e => e.sessionId!));
  const sessionsCount = sessionIds.size || (usageEvents.length > 0 ? 1 : 0);

  const agentSessionIds = new Set(usageEvents.filter(e => e.isSidechain && e.sessionId).map(e => e.sessionId!));
  const agentRuns = agentSessionIds.size;

  const maxContext = usageEvents.reduce((m, e) =>
    Math.max(m, e.inputTokens + e.outputTokens + e.cacheCreationTokens + e.cacheCreation1hTokens + e.cacheReadTokens), 0);

  const totalInput = usageEvents.reduce((s, e) => s + e.inputTokens, 0);
  const totalCacheRead = usageEvents.reduce((s, e) => s + e.cacheReadTokens, 0);
  const cacheReadPct = (totalInput + totalCacheRead) > 0
    ? Math.round(totalCacheRead / (totalInput + totalCacheRead) * 100) : 0;

  const modelCp: Record<string, number> = {};
  const projectCp: Record<string, number> = {};
  let totalWindowCp = 0;
  for (const e of usageEvents) {
    const cp = computeWeightedTokens(e);
    totalWindowCp += cp;
    modelCp[e.model] = (modelCp[e.model] ?? 0) + cp;
    if (e.projectName) projectCp[e.projectName] = (projectCp[e.projectName] ?? 0) + cp;
  }

  const projectEntries = Object.entries(projectCp).sort((a, b) => b[1] - a[1]);
  const topProject = projectEntries[0]?.[0];
  const topProjectPct = topProject && totalWindowCp > 0
    ? Math.round(projectCp[topProject] / totalWindowCp * 100) : undefined;

  const sorted = [...usageEvents].sort((a, b) => a.ts.getTime() - b.ts.getTime());
  const firstPromptAt = sorted[0]?.ts.toISOString();

  const rlEvent = windowEvents.find(e => e.limitResetAt);
  const timeToCookMins = rlEvent && sorted[0]
    ? Math.round((rlEvent.ts.getTime() - sorted[0].ts.getTime()) / 60000) : undefined;

  const { prompts, yoloPrompts, toolCounts, toolErrors } = sessionStats;
  const yoloPct = prompts > 0 ? Math.round(yoloPrompts / prompts * 100) : 0;
  const tools = Object.entries(toolCounts).sort((a, b) => b[1] - a[1]).slice(0, 10) as [string, number][];

  const tonight: Tonight = { yoloPct, cacheReadPct };
  if (outputTokens > 0) tonight.outputTokens = outputTokens;
  if (sessionsCount > 0) tonight.sessionsCount = sessionsCount;
  if (agentRuns > 0) tonight.agentRuns = agentRuns;
  if (maxContext > 0) tonight.maxContext = maxContext;
  if (Object.keys(modelCp).length > 0) tonight.models = modelCp;
  if (tools.length > 0) tonight.tools = tools;
  if (topProject) { tonight.topProject = topProject; tonight.topProjectPct = topProjectPct; }
  if (firstPromptAt) tonight.firstPromptAt = firstPromptAt;
  if (timeToCookMins !== undefined) tonight.timeToCookMins = timeToCookMins;
  if (prompts > 0) tonight.prompts = prompts;
  if (toolErrors > 0) tonight.toolErrors = toolErrors;

  return tonight;
}

export function computeLifetimeStats(allEvents: UsageEvent[]): LifetimeStats {
  const usageEvents = allEvents.filter(e => !e.limitResetAt);
  if (usageEvents.length === 0) {
    return {
      totalTokens: 0,
      tenureDays: 0,
      prompts: 0,
      topModel: 'unknown',
      models: {},
      topProject: 'unknown',
      peakHour: 0,
      busiestDay: '',
      busiestDayTokens: 0,
      maxContext: 0,
      agentHeavyPct: 0,
    };
  }

  let totalCp = 0;
  let sidechainCp = 0;
  let maxContext = 0;
  const modelCp = new Map<string, number>();
  const projectCp = new Map<string, number>();
  const hourCp = new Map<number, number>();
  const dayCp = new Map<string, number>();

  for (const e of usageEvents) {
    const cp = computeWeightedTokens(e);
    totalCp += cp;
    if (e.isSidechain) sidechainCp += cp;

    modelCp.set(e.model, (modelCp.get(e.model) ?? 0) + cp);

    const proj = e.projectName ?? 'unknown';
    projectCp.set(proj, (projectCp.get(proj) ?? 0) + cp);

    const hour = e.ts.getHours();
    hourCp.set(hour, (hourCp.get(hour) ?? 0) + cp);

    const day = toLocalDate(e.ts);
    dayCp.set(day, (dayCp.get(day) ?? 0) + cp);

    const ctx = e.inputTokens + e.outputTokens + e.cacheCreationTokens + e.cacheCreation1hTokens + e.cacheReadTokens;
    if (ctx > maxContext) maxContext = ctx;
  }

  const topModel = [...modelCp.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const topProject = [...projectCp.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const peakHour = [...hourCp.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const [busiestDay, busiestDayTokens] = [...dayCp.entries()].sort((a, b) => b[1] - a[1])[0];

  const firstTs = usageEvents[0].ts.getTime();
  const tenureDays = Math.max(1, Math.ceil((Date.now() - firstTs) / (24 * 60 * 60 * 1000)));

  const models: Record<string, number> = {};
  for (const [m, cp] of modelCp) models[m] = cp;

  return {
    totalTokens: Math.round(totalCp),
    tenureDays,
    prompts: usageEvents.length,
    topModel,
    models,
    topProject,
    peakHour,
    busiestDay,
    busiestDayTokens: Math.round(busiestDayTokens),
    maxContext,
    agentHeavyPct: totalCp > 0 ? Math.round((sidechainCp / totalCp) * 100) : 0,
  };
}
