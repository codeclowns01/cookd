# ADR-001: Cost-Proportional Token Formula

**Date:** 2026-06-11
**Status:** Accepted

## Context

Claude Code transcript files expose token fields per event: `inputTokens`, `outputTokens`,
cache creation tokens (either a flat `cacheCreationInputTokens` or two sub-tier fields when
the JSONL carries an `ephemeral` breakdown), and `cacheReadInputTokens`. The companion needed
a formula to aggregate these into a single "usage" number comparable to Anthropic's rate limit.

The naive approach — sum of all fields (sum-of-4 or S4) — was implemented first.
Live testing on development machines revealed that S4 significantly overestimated usage.
When S4 indicated ~38% consumed, the Claude Code UI showed ~20–24%.

## Decision

Use the cost-proportional (CP) formula:

```
cp = input × 1 + output × 4 + cacheCreation5m × 1.25 + cacheCreation1h × 2.0 + cacheRead × 0.1
```

These weights reflect Anthropic's relative pricing for each token type. The two cache creation
weights correspond to Anthropic's ephemeral cache tiers: 5-minute TTL (×1.25) and 1-hour TTL
(×2.0). When a JSONL entry carries only the flat `cacheCreationInputTokens` field without a
tier breakdown, the full value is treated as the 5m tier.

## Rationale

Cache reads dominate transcript data for typical developer sessions (often 90–97% of raw token
counts). Under S4, each cache-read token counts as 1 — the same as an input token. Under CP,
cache reads are weighted at 0.1, which matches their actual cost. Testing on development machines
showed CP at ~27.8% against a confirmed rate-limit boundary, aligning with the observed UI
range of 20–24%.

Empirical validation across multiple confirmed rate-limit events on development machines showed
CP values clustering within ~8% of each other at the moment of hitting the limit. S4 values
for the same events varied by over 100% (session-composition dependent), making S4 unsuitable
as a standalone limit metric.

## Consequences

- CP is the single formula used throughout the companion — in `window.ts`, `calibrate.ts`, and
  the synced `usedTokens` field.
- S4 is computed in `calibrate.ts` as a secondary signal for reference only.
- The formula weights are constants in `window.ts` (`TOKEN_WEIGHTS`).

## Files affected

- `src/adapters/claude-code/window.ts` — `TOKEN_WEIGHTS`, `computeWeightedTokens()`
- `src/adapters/claude-code/calibrate.ts` — uses `computeWeightedTokens()` for gap analysis
