# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
- Zero-config install — `npx cookd init` works out of the box with no `.env` file required

[Unreleased]: https://github.com/codeclowns01/cookd/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/codeclowns01/cookd/releases/tag/v0.1.0
