# ADR-008: AgentAdapter Interface Extensions

**Date:** 2026-06-12
**Status:** Accepted

## Context

The `AgentAdapter` interface defines the contract between the companion core and individual
agent implementations (Claude Code, Cursor, and future agents). The original interface had
three methods: `detect()`, `events()`, and `watch()`.

The sync layer needed to compute a window summary and determine the calibrated limit without
knowing which adapter was in use. This required two new capabilities on the adapter contract.

## Decision

Add two methods to `AgentAdapter`:

```typescript
weightEvent(e: UsageEvent): number;
estimatedLimit(): number | null;
```

`weightEvent()` applies the adapter's appropriate token weighting formula to a single event.
For Claude Code this is cost-proportional. For future adapters with different billing models,
the formula can differ.

`estimatedLimit()` returns the adapter's current calibrated limit in the same units as
`weightEvent()`. Returns `null` when uncalibrated — callers must handle this explicitly.
There is no silent fallback to a hardcoded constant.

## Rationale

Putting `estimatedLimit()` on the adapter (rather than as a standalone function) allows future
adapters to use their own calibration stores and their own limit concepts. Cursor, for example,
may have a completely different rate-limit mechanism.

The `null` return is intentional and documented on the interface. Callers that ignore the null
case will produce type errors, which is the desired outcome: the uncalibrated state must be
handled explicitly in the UI.

## Consequences

- All `AgentAdapter` implementations must implement both methods.
- `ClaudeCodeAdapter` reads from `~/.cookd/calibration.json` via `calibration-store.ts`.
- `CursorAdapter` stubs both methods: `weightEvent()` returns 0, `estimatedLimit()` returns null.
- The command layer (`watch.ts`, `status.ts`) reads `estimatedLimit()` to pass the limit to
  `computeWindow()`.

## Files affected

- `src/adapters/types.ts` — interface definition
- `src/adapters/claude-code/index.ts` — implementation
- `src/adapters/cursor/index.ts` — stubs
- `src/commands/watch.ts`, `src/commands/status.ts` — consume `estimatedLimit()`
