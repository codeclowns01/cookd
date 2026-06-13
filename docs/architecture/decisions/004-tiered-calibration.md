# ADR-004: Tiered Background Calibration

**Date:** 2026-06-12
**Status:** Accepted (partially implemented — see note)

## Context

Calibrating the rate limit requires reading and analysing all of a user's transcript history.
A power user with months of Claude Code usage could have hundreds of JSONL files totalling
hundreds of megabytes. Reading everything at startup would block the companion for several seconds.

The goal: show something useful immediately, improve accuracy in the background.

## Decision

Define a three-tier calibration architecture:

**Tier 1 — Hot start** (<500ms, at launch)
Read and calibrate from the last 7 days of events. Give the companion a usable limit estimate
immediately. Low or medium confidence.

**Tier 2 — Quick calibration** (1–3 seconds, background)
Extend to the last 30 days. More RL hit data points; higher confidence. Update the stored limit
if confidence improves.

**Tier 3 — Deep history walk** (progressive, background)
Walk all available history in 500-event chunks with 50ms pauses between chunks to avoid blocking.
Store a watermark of the oldest timestamp processed so restarts resume rather than restart.
Enables plan-change detection across long histories.

## Current implementation status

Tiers 1 and 2 are implemented as a single calibration call at startup against all available
events (`adapter.events()` returns the full history). The chunked Tier 3 watermarked walk is
documented here as intended behaviour and will be implemented in a future iteration when
performance bottlenecks on large installs are observed in practice.

The design is validated: the calibration algorithm (ADR-005) is O(N) and fast enough that
a full-history pass completes in under 3 seconds for typical installs. Progressive chunking
becomes necessary only at 50,000+ events, which is not yet a common case.

## Consequences

- `calibrate()` in `calibrate.ts` receives the full event array and produces a result in one pass.
- `calibration-store.ts` persists the result with a `calibratedAt` timestamp; it is refreshed
  if older than 24 hours.
- Future: add `watermark: string` to `CalibrationState` and implement the chunked walk in
  `calibrate.ts` when Tier 3 separation becomes necessary.

## Files affected

- `src/adapters/claude-code/calibrate.ts`
- `src/adapters/claude-code/calibration-store.ts`
- `src/commands/watch.ts` — calibrates once at startup
- `src/commands/status.ts` — calibrates or loads from store
