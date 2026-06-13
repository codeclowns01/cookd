# ADR-003: Self-Calibrating Limits, No External Anchor

**Date:** 2026-06-12
**Status:** Accepted

## Context

To display a usage percentage, the companion needs to know the user's rate limit. Anthropic does
not expose the limit via API. The only way to learn it is to observe rate-limit events in the
user's own transcript history.

An earlier design hardcoded the limit observed on a Pro plan development machine (~4.5M CP).
This was rejected for two reasons:

1. **Plan contamination** — a user on Max plan (5× or 20× higher limit) would immediately get
   false "near limit" warnings because the bootstrap constant is far below their actual ceiling.
2. **Factual inaccuracy** — Anthropic can change limits at any time. A hardcoded constant from
   development becomes wrong silently.

## Decision

Derive the limit entirely from the user's own transcript history. No externally sourced constant
is used as the limit estimate. See ADR-005 for the detection algorithm.

A soft prior of ~4.5M CP is used only in the `status` command's display when no calibration
exists at all (zero historical data): the display reads "calibrating..." rather than showing a
percentage, making the unknown state explicit to the user.

## Rationale

Each user's limit is individual (plan + any extra credits). The only reliable source of truth is
the history of rate-limit events on that user's own machine. Using another machine's data —
regardless of how well-characterised — introduces systematic error for users on different plans.

## Consequences

- `adapter.estimatedLimit()` returns `null` until at least one rate-limit event is detected in
  history. Callers must handle `null` explicitly.
- `computeWindow()` returns `ratio = 0` when no limit is provided; the status command shows
  "calibrating..." instead of a percentage.
- Users on new installs with no rate-limit history will not see a percentage until they
  accumulate enough data. This is intentional and honest.

## Files affected

- `src/adapters/claude-code/calibrate.ts` — no hardcoded anchor
- `src/adapters/claude-code/index.ts` — `estimatedLimit()` returns `null` when uncalibrated
- `src/adapters/claude-code/window.ts` — `ratio` is `0` when `limit` is not provided
- `src/commands/status.ts` — handles `null` limit with "calibrating..." display
