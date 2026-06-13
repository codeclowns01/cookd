# Architecture Overview

> Living document. Update when files change. For the *why* behind each decision, see `decisions/`.

## What cookd does

cookd is a CLI companion that reads Claude Code transcript files, computes the user's current token
usage against their rate limit, and syncs a window summary to the cookd backend. It never reads
prompt content — only token counts and timestamps.

## Module map

```
src/
  cli.ts                          — entry point, registers commands
  adapters/
    types.ts                      — UsageEvent, AgentAdapter interface
    registry.ts                   — detectAdapter() scans for known agents
    claude-code/
      paths.ts                    — locates ~/.claude/projects/ JSONL files
      transcript.ts               — parses JSONL lines, extracts token counts
      window.ts                   — computeWindow(): rolling 5h token sum
      calibrate.ts                — analyzeGaps(), calibrate(): limit calibration engine
      calibration-store.ts        — load/save ~/.cookd/calibration.json
      wrapped.ts                  — computeLifetimeStats(), computeDailyStats(), computeModelBreakdown()
      index.ts                    — ClaudeCodeAdapter: implements AgentAdapter
    cursor/
      index.ts                    — CursorAdapter: stub (future)
  auth/
    credentials.ts                — load/save ~/.cookd/credentials.json
    device-link.ts                — device pairing flow (link-start, poll-for-link)
  sync/
    events.ts                     — WindowSummary, SessionStatus types
    queue.ts                      — SQLite retry queue (~/.cookd/local.db)
    client.ts                     — syncWindowState(), syncLifetimeStats(): Bearer auth POST to usage-ingest / wrapped-sync
  commands/
    init.tsx                      — cookd init: device link flow
    status.ts                     — cookd status: display current window
    watch.ts                      — cookd watch: background sync loop
    wrapped.ts                    — cookd wrapped: usage summary
  ui/
    theme.ts                      — colour constants
    helpers.ts                    — formatTokens, formatDuration, receiptRow
    ink/                          — React/Ink UI components
```

## Data flow

```
~/.claude/projects/**/*.jsonl
        │
        ▼
  transcript.ts (parse token counts, flags, dedup identifiers)
        │
        ▼  (all events, sorted by timestamp)
        ├── window.ts (rolling 5h sum → weightedTokens, ratio)
        │       │
        │       └── calibrate.ts (gap analysis → cpLimit, plan, confidence)
        │               └── calibration-store.ts (persist to calibration.json)
        │
        ├── wrapped.ts
        │       ├── computeModelBreakdown(windowEvents) → ModelSegment[]
        │       ├── computeDailyStats(allEvents, date) → DailyStats
        │       └── computeLifetimeStats(allEvents) → LifetimeStats  [weekly]
        │
        └── client.ts
                ├── syncWindowState(WindowSummary) → Bearer POST → usage-ingest
                ├── syncLifetimeStats(LifetimeStats) → Bearer POST → wrapped-sync
                └── queue.ts (SQLite retry on failure)
```

## Token formula

Cost-proportional (cp): `input×1 + output×4 + cacheCreation5m×1.25 + cacheCreation1h×2.0 + cacheRead×0.1`

The two cache creation weights map to Anthropic's ephemeral cache tiers (5-minute TTL and
1-hour TTL). When a transcript entry carries only the flat `cacheCreationInputTokens` field,
the full value is treated as the 5m tier.

See ADR-001 for why this was chosen over sum-of-4.

## Calibration

At startup, the companion runs `calibrate(events)` on all available transcript history.
It identifies the user's rate-limit ceiling from the distribution of high-usage gaps —
no external constant needed. The result is stored in `~/.cookd/calibration.json` and
refreshed every 24 hours.

See ADR-003, ADR-004, ADR-005.

## What the companion never reads

- Prompt or response text
- Code or file contents
- Full directory paths (only the directory basename is used)
- `~/.claude/.credentials.json`

See ADR-010.

## Environment variables

| Variable | Purpose |
|---|---|
| `COOKD_API_URL` | Backend base URL (required for sync) |
