import { describe, it, expect } from 'vitest';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { parseJsonl, deduplicateEvents } from '../../../src/adapters/claude-code/transcript.js';
import type { UsageEvent } from '../../../src/adapters/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtures = join(__dirname, '../../fixtures/claude-code');

function makeEvent(overrides: Partial<UsageEvent> = {}): UsageEvent {
  return {
    ts: new Date('2026-06-11T10:00:00.000Z'),
    model: 'claude-sonnet-4-6',
    inputTokens: 1000,
    outputTokens: 500,
    cacheCreationTokens: 0,
    cacheCreation1hTokens: 0,
    cacheReadTokens: 0,
    ...overrides,
  };
}

describe('parseJsonl', () => {
  it('returns empty array for empty file', async () => {
    const { events } = await parseJsonl(join(fixtures, 'empty.jsonl'));
    expect(events).toEqual([]);
  });

  it('parses a single valid event', async () => {
    const { events } = await parseJsonl(join(fixtures, 'single-event.jsonl'));
    expect(events).toHaveLength(1);
    expect(events[0].model).toBe('claude-sonnet-4-6');
    expect(events[0].inputTokens).toBe(1000);
    expect(events[0].outputTokens).toBe(500);
    expect(events[0].cacheCreationTokens).toBe(200);
    expect(events[0].cacheCreation1hTokens).toBe(0);
    expect(events[0].cacheReadTokens).toBe(100);
  });

  it('parses multiple events in order', async () => {
    const { events } = await parseJsonl(join(fixtures, 'multi-event.jsonl'));
    expect(events).toHaveLength(3);
    expect(events[0].ts < events[1].ts).toBe(true);
    expect(events[1].ts < events[2].ts).toBe(true);
    expect(events[1].model).toBe('claude-opus-4-8');
  });

  it('skips malformed lines and non-assistant entries, returns valid ones', async () => {
    const { events } = await parseJsonl(join(fixtures, 'malformed.jsonl'));
    expect(events).toHaveLength(1);
    expect(events[0].inputTokens).toBe(100);
  });

  it('parses cache tier breakdown into separate fields', async () => {
    const { events } = await parseJsonl(join(fixtures, 'cache-tiers.jsonl'));
    expect(events).toHaveLength(1);
    expect(events[0].cacheCreationTokens).toBe(300);
    expect(events[0].cacheCreation1hTokens).toBe(200);
    expect(events[0].cacheReadTokens).toBe(100);
  });

  it('appends -fast suffix when speed is fast', async () => {
    const { events } = await parseJsonl(join(fixtures, 'fast-mode.jsonl'));
    expect(events).toHaveLength(1);
    expect(events[0].model).toBe('claude-opus-4-8-fast');
  });

  it('extracts limitResetAt from error entry and excludes its tokens from CP', async () => {
    const { events } = await parseJsonl(join(fixtures, 'error-entry.jsonl'));
    expect(events).toHaveLength(2);
    const errorEvent = events.find(e => e.limitResetAt);
    expect(errorEvent).toBeDefined();
    expect(errorEvent!.limitResetAt).toEqual(new Date(1781193600 * 1000));
    expect(errorEvent!.inputTokens).toBe(0);
    expect(errorEvent!.outputTokens).toBe(0);
  });

  it('parses messageId from message.id', async () => {
    const { events } = await parseJsonl(join(fixtures, 'error-entry.jsonl'));
    const normalEvent = events.find(e => !e.limitResetAt);
    expect(normalEvent!.messageId).toBe('msg_001');
  });

  it('counts prompts, tool calls, tool errors, and yolo mode from session stats', async () => {
    const { events, sessionStats } = await parseJsonl(join(fixtures, 'session-stats.jsonl'));
    expect(events).toHaveLength(1);
    expect(sessionStats.prompts).toBe(3);
    expect(sessionStats.yoloPrompts).toBe(2);
    expect(sessionStats.toolCounts).toEqual({ Read: 1, Edit: 1 });
    expect(sessionStats.toolErrors).toBe(1);
  });

  it('filters session stats to the specified date', async () => {
    const { sessionStats } = await parseJsonl(join(fixtures, 'session-stats.jsonl'), '2099-01-01');
    expect(sessionStats.prompts).toBe(0);
    expect(sessionStats.toolErrors).toBe(0);
  });
});

describe('deduplicateEvents', () => {
  it('keeps event without messageId unchanged', () => {
    const e = makeEvent();
    expect(deduplicateEvents([e])).toHaveLength(1);
  });

  it('keeps single event with messageId', () => {
    const e = makeEvent({ messageId: 'msg_1' });
    expect(deduplicateEvents([e])).toHaveLength(1);
  });

  it('deduplicates: non-sidechain wins over sidechain with same messageId', () => {
    const parent = makeEvent({ messageId: 'msg_1', isSidechain: false, inputTokens: 1000, outputTokens: 500 });
    const sidechain = makeEvent({ messageId: 'msg_1', isSidechain: true, inputTokens: 500, outputTokens: 250 });
    const result = deduplicateEvents([sidechain, parent]);
    expect(result).toHaveLength(1);
    expect(result[0].isSidechain).toBe(false);
    expect(result[0].inputTokens).toBe(1000);
  });

  it('deduplicates: higher token count wins when both same sidechain status', () => {
    const low = makeEvent({ messageId: 'msg_1', isSidechain: false, inputTokens: 500, outputTokens: 200 });
    const high = makeEvent({ messageId: 'msg_1', isSidechain: false, inputTokens: 1000, outputTokens: 500 });
    const result = deduplicateEvents([low, high]);
    expect(result).toHaveLength(1);
    expect(result[0].inputTokens).toBe(1000);
  });

  it('does not merge events without messageId even if identical', () => {
    const e1 = makeEvent({ inputTokens: 100 });
    const e2 = makeEvent({ inputTokens: 100 });
    expect(deduplicateEvents([e1, e2])).toHaveLength(2);
  });
});
