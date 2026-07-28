# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- 15-minute usage buckets — the companion now ships the *shape* of usage (raw token components per 15-minute slot) instead of a single pre-computed number, so the 5-hour window can be derived at read time. Components are stored unweighted, which means the token weights can be re-tuned later and all history re-derives correctly
- `Stop` hook — fires at the end of every assistant turn, so usage stays current *during* a session rather than only at its boundaries. Sessions here routinely run for days; one measured session ran 240 hours and would have reported once
- Two gates before any work happens, so an idle machine costs exactly zero: a `stat`-only signature over the transcript tree (no file contents read), then a growth threshold of 5% of the calibrated limit
- Companion self-report — `companionVersion`, `hooksInstalled` and `lastError` ride each sync so the app can tell you *why* your laptop went quiet instead of just that it did
- Scan wall-time instrumentation (`p95ScanMs`), so the decision to revisit incremental reads has a measurement behind it rather than a guess

### Fixed
- **Subagent transcripts were never counted.** Discovery read exactly one directory level, so transcripts written below the project directory were invisible — 8% of usage machine-wide, and 20% on an agent-heavy machine. `tonight.agentRuns` and `agentHeavyPct` were structurally always 0. Discovery now recurses, capped at depth 4, with symlink cycles broken by real-path de-duplication
- **Already-linked devices could never be offered auto-sync.** The re-init guard resolved an outcome the offer did not accept, structurally excluding everyone who linked before auto-sync existed
- **`npx @codeclowns/cookd` never replaced an installed binary.** The command always pulls the newest package, but the hook runs the pinned binary in `~/.cookd/bin` — so re-running it looked like an upgrade and changed nothing. The installed version is now recorded beside the binary and replaced when the release moves on; an unmarked binary counts as stale
- A failed push no longer advances the growth gate, so a queued payload is retried on the next sync instead of waiting for another 5% of growth

### Security
- Transcript discovery is confined to the project directory. Making discovery recursive also made it possible to leave the tree: `readdir` reports a symlinked directory as a link, so following those — required for subagents, never needed by the one-level version — meant a symlink planted under `~/.claude/projects/` would be walked into. Every resolved path is now checked against the resolved root

### Changed
- Binaries are compiled in CI on every pull request, not only at tag time. Both prior releases published to npm and then failed to build any binary, leaving `downloadBinary()` with nothing to fetch

## [0.1.0] - 2026-06-15

### Added
- `cookd init` — device-link handshake with animated TUI; reads local Claude Code transcripts and prints your field notes before generating a six-character press code
- `cookd status` — snapshot of your current rolling window: tokens used, limit, percentage, model breakdown
- `cookd watch` — background file watcher with real-time sync to your cookd dashboard; debounced 15s, syncs on ≥2% change, RL event, or 5-minute heartbeat
- `cookd wrapped` — usage anatomy for the current window rendered as a receipt
- Claude Code adapter — reads `~/.claude/projects/` JSONL transcripts; token counts only, prompt content never leaves your machine
- Tonight's Anatomy — per-session stats derived without reading prompts: prompt count, YOLO-mode percentage, tool usage breakdown, agent runs, max context, cache read rate, first-prompt timestamp, time-to-cook
- Write-ahead SQLite queue (`~/.cookd/local.db`) for reliable sync with automatic retry
- `AgentAdapter` interface — open contract for community-contributed agent support
- Zero-config install — `npx @codeclowns/cookd init` works out of the box with no `.env` file required

[Unreleased]: https://github.com/codeclowns01/cookd/compare/v0.1.1...HEAD
[0.1.0]: https://github.com/codeclowns01/cookd/releases/tag/v0.1.0
