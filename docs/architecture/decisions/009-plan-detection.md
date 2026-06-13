# ADR-009: Plan Detection from Calibrated Limit

**Date:** 2026-06-12
**Status:** Accepted

## Context

cookd targets Claude Code users on Pro and Max plans. The companion has no direct way to query
a user's Anthropic plan — it is not in the transcript files and is not exposed via any API.

The calibrated CP limit (ADR-005) is the best available proxy for plan tier, since Anthropic's
rate limits scale with plan.

## Decision

Classify the plan from the calibrated CP limit using the following thresholds:

| CP limit | Plan |
|---|---|
| < 5,000,000 | `pro` |
| 5,000,000 – 45,000,000 | `max5x` |
| > 45,000,000 | `max20x` |

These thresholds are wide to account for calibration uncertainty and plan boundary ambiguity.
They are in the `detectPlan()` function in `calibrate.ts`.

Plan changes are detectable if the calibrated limit shifts by >30% across time segments —
e.g. if the user upgrades from Pro to Max, subsequent RL hits will cluster near a much higher CP
value, and the running calibration will reflect this.

## Rationale

The thresholds are derived from:
- Pro plan: empirically confirmed at ~4.5M CP on development test machines.
- Max 5×: expected to be in the range of 5–15M CP (not yet empirically confirmed on Max machines;
  conservative upper bound of 45M leaves room for uncertainty).
- Max 20×: above 45M.

These are working estimates. As the companion accumulates data from Max plan users, the thresholds
should be reviewed and narrowed. This ADR should be superseded when better data exists.

Users with extra usage credits may see a calibrated limit that falls between plan tiers; the
companion will report the closest tier.

## Consequences

- `plan` is stored in `calibration.json` and included in the `WindowSummary` sent to the backend.
- Plan detection is best-effort and labeled with a `calibrationConfidence` field.
- The companion never hardcodes a plan assumption; the plan is always derived from observed data.

## Files affected

- `src/adapters/claude-code/calibrate.ts` — `detectPlan()`, `PlanTier` type
- `src/adapters/claude-code/calibration-store.ts` — `CalibrationState.plan`
- `src/sync/events.ts` — `WindowSummary.plan`
