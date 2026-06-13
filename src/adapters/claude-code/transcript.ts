import { createReadStream } from 'fs';
import { createInterface } from 'readline';
import type { UsageEvent } from '../types.js';

interface RawCacheCreation {
  ephemeral_5m_input_tokens?: number;
  ephemeral_1h_input_tokens?: number;
}

interface RawUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation?: RawCacheCreation;
  speed?: 'standard' | 'fast';
}

interface RawMessage {
  role?: string;
  model?: string;
  id?: string;
  usage?: RawUsage;
  content?: unknown;
}

interface RawEntry {
  type?: string;
  timestamp?: string;
  message?: RawMessage;
  requestId?: string;
  isSidechain?: boolean;
  isApiErrorMessage?: boolean;
}

function extractText(content: unknown): string | null {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    for (const item of content) {
      if (item && typeof item === 'object') {
        const t = (item as Record<string, unknown>).text;
        if (typeof t === 'string') return t;
      }
    }
    return null;
  }
  if (content && typeof content === 'object') {
    const t = (content as Record<string, unknown>).text;
    if (typeof t === 'string') return t;
  }
  return null;
}

function parseLocalResetTime(
  rawH: string, rawM: string, ampm: string, tz: string, entryTs: string | undefined,
): Date {
  let h = parseInt(rawH, 10);
  const m = parseInt(rawM, 10);
  if (ampm.toLowerCase() === 'pm' && h !== 12) h += 12;
  if (ampm.toLowerCase() === 'am' && h === 12) h = 0;

  const ref = entryTs ? new Date(entryTs) : new Date();
  const utcMs = new Date(ref.toLocaleString('en-US', { timeZone: 'UTC' })).getTime();
  const tzMs  = new Date(ref.toLocaleString('en-US', { timeZone: tz })).getTime();
  const offsetMs = tzMs - utcMs;

  const localMs = ref.getTime() + offsetMs;
  const DAY_MS  = 24 * 60 * 60 * 1000;
  const localMidnightMs = localMs - (localMs % DAY_MS);
  const utcMidnightMs   = localMidnightMs - offsetMs;

  const resetMs = utcMidnightMs + (h * 60 + m) * 60_000;
  const result  = new Date(resetMs);
  return result.getTime() >= ref.getTime() ? result : new Date(resetMs + DAY_MS);
}

function extractResetTime(entry: RawEntry): Date | null {
  if (!entry.isApiErrorMessage) return null;
  const text = extractText(entry.message?.content);
  if (!text) return null;

  // Old format: "Claude AI usage limit reached|<unix_seconds>"
  const oldMatch = /Claude AI usage limit reached\|(\d+)/.exec(text);
  if (oldMatch) {
    const seconds = parseInt(oldMatch[1], 10);
    return seconds > 0 ? new Date(seconds * 1000) : null;
  }

  // New format: "You've hit your session limit · resets H:MMpm (Timezone)"
  const newMatch = /resets\s+(\d{1,2}):(\d{2})(am|pm)\s*\(([^)]+)\)/i.exec(text);
  if (newMatch) {
    return parseLocalResetTime(newMatch[1], newMatch[2], newMatch[3], newMatch[4], entry.timestamp);
  }

  // Fallback: detectable RL hit but unparseable time → approximate reset in 5h
  if (/session limit|usage limit/i.test(text)) {
    const ts = entry.timestamp ? new Date(entry.timestamp) : new Date();
    return new Date(ts.getTime() + 5 * 60 * 60 * 1000);
  }

  return null;
}

function parseEntry(line: string): UsageEvent | null {
  let entry: RawEntry;
  try {
    entry = JSON.parse(line) as RawEntry;
  } catch {
    return null;
  }

  const isErrorEntry = entry.isApiErrorMessage === true;
  const isAssistant = entry.type === 'assistant' || entry.message?.role === 'assistant';

  if (!isAssistant && !isErrorEntry) return null;

  const usage = entry.message?.usage;
  const ts = entry.timestamp ? new Date(entry.timestamp) : new Date();

  if (isErrorEntry) {
    const limitResetAt = extractResetTime(entry);
    if (!limitResetAt) return null;
    return {
      ts,
      model: entry.message?.model ?? 'unknown',
      inputTokens: usage?.input_tokens ?? 0,
      outputTokens: usage?.output_tokens ?? 0,
      cacheCreationTokens: 0,
      cacheCreation1hTokens: 0,
      cacheReadTokens: usage?.cache_read_input_tokens ?? 0,
      isSidechain: entry.isSidechain ?? false,
      messageId: entry.message?.id,
      limitResetAt,
    };
  }

  if (!usage) return null;

  const inputTokens = usage.input_tokens ?? 0;
  const outputTokens = usage.output_tokens ?? 0;
  if (inputTokens === 0 && outputTokens === 0) return null;

  const cacheBreakdown = usage.cache_creation;
  const cacheCreationTokens = cacheBreakdown
    ? (cacheBreakdown.ephemeral_5m_input_tokens ?? 0)
    : (usage.cache_creation_input_tokens ?? 0);
  const cacheCreation1hTokens = cacheBreakdown
    ? (cacheBreakdown.ephemeral_1h_input_tokens ?? 0)
    : 0;
  const cacheReadTokens = usage.cache_read_input_tokens ?? 0;

  const baseModel = entry.message?.model ?? 'unknown';
  const model = usage.speed === 'fast' ? `${baseModel}-fast` : baseModel;

  return {
    ts,
    model,
    inputTokens,
    outputTokens,
    cacheCreationTokens,
    cacheCreation1hTokens,
    cacheReadTokens,
    isSidechain: entry.isSidechain ?? false,
    messageId: entry.message?.id,
  };
}

function shouldReplaceDedup(existing: UsageEvent, candidate: UsageEvent): boolean {
  const existingIsSidechain = existing.isSidechain ?? false;
  const candidateIsSidechain = candidate.isSidechain ?? false;
  if (existingIsSidechain && !candidateIsSidechain) return true;
  if (!existingIsSidechain && candidateIsSidechain) return false;
  return (candidate.inputTokens + candidate.outputTokens) > (existing.inputTokens + existing.outputTokens);
}

export function deduplicateEvents(events: UsageEvent[]): UsageEvent[] {
  const byMessageId = new Map<string, UsageEvent>();
  const noId: UsageEvent[] = [];

  for (const event of events) {
    if (!event.messageId) {
      noId.push(event);
      continue;
    }
    const existing = byMessageId.get(event.messageId);
    if (!existing) {
      byMessageId.set(event.messageId, event);
    } else if (shouldReplaceDedup(existing, event)) {
      byMessageId.set(event.messageId, event);
    }
  }

  return [...byMessageId.values(), ...noId];
}

export async function parseJsonl(filePath: string): Promise<UsageEvent[]> {
  const events: UsageEvent[] = [];
  const rl = createInterface({
    input: createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const event = parseEntry(trimmed);
    if (event) events.push(event);
  }

  return events;
}
