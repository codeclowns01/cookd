# Architecture Decision Records

This directory documents every significant design decision made in the cookd companion.

ADRs are immutable. When a decision is reversed, a new ADR is written that supersedes the old one.
The `overview.md` file is the living document — it reflects the current architecture.

| # | Title | Date | Status |
|---|---|---|---|
| [001](decisions/001-token-formula.md) | Cost-Proportional Token Formula | 2026-06-11 | Accepted |
| [002](decisions/002-window-model.md) | Rolling 5-Hour Window | 2026-06-11 | Accepted |
| [003](decisions/003-self-calibration.md) | Self-Calibrating Limits, No External Anchor | 2026-06-12 | Accepted |
| [004](decisions/004-tiered-calibration.md) | Tiered Background Calibration | 2026-06-12 | Accepted |
| [005](decisions/005-rl-hit-detection.md) | Distribution-Based RL Hit Detection | 2026-06-12 | Accepted |
| [006](decisions/006-auth-model.md) | Bearer Token Auth, HMAC Removed | 2026-06-12 | Accepted |
| [007](decisions/007-sync-payload.md) | Sync Sends Window Summary, Not Raw Events | 2026-06-12 | Accepted |
| [008](decisions/008-agent-adapter-interface.md) | AgentAdapter Interface Extensions | 2026-06-12 | Accepted |
| [009](decisions/009-plan-detection.md) | Plan Detection from Calibrated Limit | 2026-06-12 | Accepted |
| [010](decisions/010-privacy-data-model.md) | Privacy: What the Companion Reads and Never Reads | 2026-06-11 | Accepted |
