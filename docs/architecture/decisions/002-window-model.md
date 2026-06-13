# ADR-002: Rolling 5-Hour Window

**Date:** 2026-06-11
**Status:** Accepted

## Context

Anthropic's rate limit operates over a 5-hour window. The companion needed to match this window
model to produce accurate usage percentages.

Two models were considered:
1. **Anchored** — window starts at the last reset event and runs forward 5 hours.
2. **Rolling** — window looks backward 5 hours from the current moment at all times.

## Decision

Use a true rolling 5-hour backward-looking window: at any point in time, the window contains all
events with `ts >= now - 5h`.

## Rationale

Empirical analysis of transcript data from development machines showed that after a rate-limit
reset, token usage in the rolling window continued to include events from before the reset until
those events naturally aged out of the 5-hour lookback. This matches rolling semantics, not
anchored semantics.

Under the anchored model, a new 5-hour window would start clean at the reset point, giving a
false reading of 0% immediately after recovery. The rolling model correctly shows residual usage
from recent events — which is what Anthropic's system actually tracks.

## Consequences

- `computeWindow()` in `window.ts` always computes `windowStart = now - WINDOW_MS` and filters
  events within that range.
- There is no concept of a "reset point" stored in the companion; the window is always derived
  from the current time.
- Post-reset sessions will show non-zero usage if recent events are still within the 5-hour
  lookback — this is correct behaviour.

## Files affected

- `src/adapters/claude-code/window.ts` — `computeWindow()`, `WINDOW_MS`
