# ADR-007: Sync Sends Window Summary, Not Raw Events

**Date:** 2026-06-12
**Status:** Accepted

## Context

The original `syncEvents()` function serialised the full `UsageEvent[]` array and posted it
to the backend. This meant:
- Raw token counts from every API call in the current window were transmitted.
- The backend would need to re-compute the window state from raw events.
- The payload grew linearly with session length.

The deployed `usage-ingest` edge function expected a different shape:
`{ status, usedTokens, limitTokens, pctUsed, windowStart, resetsAt }` — a pre-computed summary.

## Decision

The companion computes the window summary locally and sends only the summary. Raw events never
leave the device.

```typescript
interface ModelSegment {
  model: string;
  cpTokens: number;
  pctOfWindow: number;
}

interface DailyStats {
  localDate: string;              // "YYYY-MM-DD" in user's local timezone
  totalCp: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  sessionCount: number;
  limitHitCount: number;
  modelBreakdown: Record<string, number>;
  firstSessionAt: string | null;
  lastActivityAt: string | null;
}

interface WindowSummary {
  status: 'idle' | 'cooking' | 'cookd';
  usedTokens: number;             // CP tokens used in the rolling window
  limitTokens: number | null;
  pctUsed: number | null;
  windowStart: string | null;
  resetsAt: string | null;
  plan: string | null;
  calibrationConfidence: string;
  modelBreakdown: ModelSegment[]; // per-model CP breakdown for the current window
  dailyStats: DailyStats;         // accumulation stats for the user's local calendar day
}
```

## Rationale

Computing the summary on-device is consistent with the privacy model (ADR-010): raw events
contain timestamps that could in principle reveal working patterns. Sending only aggregates
reduces the surface area of transmitted data to the minimum needed by the backend.

It also simplifies the backend: `usage-ingest` upserts a `limit_states` row directly from
the payload rather than reprocessing events.

## Consequences

- `src/sync/events.ts` now exports `WindowSummary` and `SessionStatus` instead of `SyncEvent`.
- `src/sync/queue.ts` queues `WindowSummary` objects instead of event arrays.
- `src/sync/client.ts` posts a single `WindowSummary` per sync call.
- The `usedTokens` field is in CP units, matching `weightedTokens` from `computeWindow()`.

## Files affected

- `src/sync/events.ts` — replaced `SyncPayload`/`SyncEvent` with `WindowSummary`/`SessionStatus`
- `src/sync/queue.ts` — updated to queue `WindowSummary`
- `src/sync/client.ts` — `syncWindowState()` replaces `syncEvents()`
- `src/commands/watch.ts` — builds and sends `WindowSummary`
