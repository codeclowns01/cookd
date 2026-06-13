# ADR-005: Distribution-Based RL Hit Detection

**Date:** 2026-06-12
**Status:** Accepted

## Context

To calibrate the rate limit (ADR-003), the companion must identify which gaps in a user's
transcript history were caused by hitting the rate limit versus the user simply pausing.

A threshold-based approach (e.g. "gap with CP > 4M is an RL hit") requires knowing the limit
in advance — a circular dependency. An external anchor is explicitly rejected (ADR-003).

## Decision

Use the distribution of CP values at gap points to self-identify the rate-limit ceiling.

Algorithm:

1. Walk all events in chronological order using a sliding two-pointer window (O(N) time).
2. At each gap between consecutive events where `10min ≤ gap < 5h`, record the rolling 5h CP
   value at the moment the gap started.
3. Sort all recorded CP values descending.
4. The top cluster — gaps within 25% of the maximum CP value — are classified as RL hits.
5. The calibrated limit is the median of that cluster.

Confidence tiers:
- 0 RL hits → `none` (no limit estimate)
- 1 RL hit  → `low` (limit = observed max × 1.02)
- 2 RL hits → `medium`
- 3+ RL hits → `high` (limit = median of cluster)

Gaps ≥ 5 hours are excluded as cold starts where the window would have naturally expired.

## Rationale

Rate-limit events in real transcript data form a tight cluster near the actual ceiling (observed
spread of ~8% across confirmed hits on development test machines). User pauses are scattered
at much lower CP values and are separated from RL hits by a natural gap in the distribution.
The 25% cluster threshold safely captures the RL cluster without pulling in user pauses.

The O(N) sliding window ensures calibration completes in milliseconds regardless of history size.

## Consequences

- No externally sourced CP threshold is used anywhere in the calibration path.
- The algorithm is plan-agnostic: it discovers the user's specific ceiling regardless of whether
  they are on Pro, Max 5×, or Max 20×.
- Plan changes are detectable if the calibrated limit shifts significantly across time segments.

## Files affected

- `src/adapters/claude-code/calibrate.ts` — `analyzeGaps()`, `calibrateFromGaps()`, `calibrate()`
- `test/adapters/claude-code/calibrate.test.ts`
