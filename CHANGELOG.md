# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- `cookd init` — device-link handshake with animated TUI
- `cookd status` — current rolling window usage snapshot
- `cookd watch` — background file watcher with sync loop
- `cookd wrapped` — usage anatomy for the current window
- Claude Code adapter — reads `~/.claude/projects/` JSONL transcripts
- Write-ahead SQLite queue with WAL mode
- Five-gate request signing (device token → nonce → timestamp → sequence → schema)
- `AgentAdapter` interface — community contract for adding agent support

[Unreleased]: https://github.com/codeclowns01/cookd/compare/HEAD...HEAD
