# ADR-010: Privacy — What the Companion Reads and Never Reads

**Date:** 2026-06-11
**Status:** Accepted

## Context

The Claude Code companion has read access to `~/.claude/projects/`, which contains full
conversation transcripts including all prompts, responses, file contents, and code. This is
a significant trust surface. Users install the companion to track usage — not to share
their work.

This ADR records the explicit boundary of what the companion reads from these files.

## Decision

### What the companion reads from transcript files

- `inputTokens` (integer)
- `outputTokens` (integer)
- `cacheCreationInputTokens` — flat integer; or `cache_creation.ephemeral_5m_input_tokens` and
  `cache_creation.ephemeral_1h_input_tokens` when the entry carries the tier breakdown
- `cacheReadInputTokens` (integer)
- Event timestamp
- `model` — for adapter detection and aggregated model breakdown stats
- `isApiErrorMessage` — boolean flag (no content read)
- `isSidechain` — boolean flag (no content read)
- `message.id` — opaque message identifier used for deduplication only, not content
- `requestId` — opaque request identifier used for deduplication only, not content
- Rate-limit reset timestamp — a Unix epoch integer extracted from error entries where
  `isApiErrorMessage: true`; only the integer value is extracted, never the surrounding text

### What the companion never reads

- Prompt text or response text
- Code or file contents referenced in conversations
- Any `content`, `text`, `input`, or string field from message bodies
- Full directory paths (only the directory basename is used for `topProject`)
- `~/.claude/.credentials.json` (Anthropic auth token — never touched)

### What is synced to the backend

- `WindowSummary`: aggregated CP totals for the rolling 5-hour window, per-day stats, and
  model breakdown (model names are publicly known Anthropic identifiers, not user content)
- `LifetimeStats`: aggregate metrics across all transcript history including total tokens,
  top model, peak hour, and project directory basename for `topProject`
- No per-event data. No individual event timestamps.

### Child process security

All subprocess calls use `execFile()` with explicit argument arrays. Shell-string execution
via `exec()` is prohibited to prevent command injection.

## Rationale

The companion's value is in the numbers, not the content. Reading only token counts gives the
companion everything it needs to compute usage percentages, detect rate-limit events, and
calibrate limits. There is no technical need to read content.

Publishing a tool with read access to user transcripts creates a trust obligation. This ADR
exists so that the boundary is explicit, reviewable, and enforced at the code level.

## Consequences

- `src/adapters/claude-code/transcript.ts` is the only file that touches raw JSONL content.
- Model names are included in model breakdown stats synced to the backend. They are publicly
  known Anthropic identifiers (`claude-sonnet-4-5`, etc.), not user-generated content.
- Project directory basenames appear in lifetime stats as `topProject`. Full paths are never
  transmitted.
- If a future feature requires reading prompt text, file contents, or code, it must be
  proposed as a new ADR with explicit justification and user consent.

## Files affected

- `src/adapters/claude-code/transcript.ts` — the only file that touches raw JSONL content
- `src/sync/events.ts` — `WindowSummary` defines exactly what leaves the device
