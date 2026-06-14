# Security Policy

## What the companion reads

The companion parses JSONL files at `~/.claude/projects/**/*.jsonl` — the transcripts Claude Code writes locally for every session. From each entry it reads:

**Numeric fields:**
- `message.usage.input_tokens`
- `message.usage.output_tokens`
- `message.usage.cache_creation_input_tokens`
- `message.usage.cache_creation.ephemeral_5m_input_tokens`
- `message.usage.cache_creation.ephemeral_1h_input_tokens`
- `message.usage.cache_read_input_tokens`

**System identifiers (not user content):**
- `message.model` — Anthropic model identifier (e.g., `claude-sonnet-4-6`)
- `message.id` — opaque dedup key used internally; not transmitted
- Tool function names from `tool_use` content items — the `name` field only (e.g., `"Read"`, `"Edit"`, `"Bash"`); the `input` field is never read

**Boolean flags:**
- `isSidechain` — whether the request came from an agent/subagent turn
- `isApiErrorMessage` — whether this entry is a rate-limit error
- `is_error` on `tool_result` items — whether a tool call failed

**Control values:**
- `permissionMode` — checked for the string `"bypassPermissions"` to set a boolean flag; not transmitted as text
- `timestamp` — entry timestamp used to derive session timing

**On rate-limit error entries only:** The error message body is parsed to extract a reset timestamp (a `H:MMpm Timezone` string). The reset time is transmitted; the message text is discarded.

**From file paths:** The directory basename of the enclosing project folder is extracted from the path to `~/.claude/projects/<basename>/`. The full path is never read beyond the basename.

**Presence check only:** User-turn message content is checked for non-empty length to count prompts. The text is never read, stored, or transmitted.

---

## What leaves your machine

All data goes to Supabase. The companion makes four types of outbound requests.

### Device link — once, on `cookd init`

| Field | Type | Description |
|---|---|---|
| `deviceId` | string | Random 32-char hex generated locally at link time |

No hostname, username, email, or machine identifier is sent. The `deviceId` is the only identity the backend ever sees.

---

### Usage sync — ongoing, via `cookd watch`

Sent when the window shifts ≥2%, a rate-limit event fires, or 5 minutes elapse without a sync.

| Field | Type | Description |
|---|---|---|
| `status` | `"idle" \| "cooking" \| "cookd"` | Current window state |
| `usedTokens` | integer | Weighted CP tokens in current 5h window |
| `limitTokens` | integer \| null | Measured token ceiling |
| `pctUsed` | float \| null | Percentage of limit consumed |
| `windowStart` | ISO timestamp | 5h window start |
| `resetsAt` | ISO timestamp | When the window resets |
| `calibrationConfidence` | `"none" \| "low" \| "medium" \| "high"` | Confidence in the limit estimate |
| `modelBreakdown` | `{ [modelId]: cpTokens }` | Weighted tokens per model in window |
| `dailyStats.localDate` | `"YYYY-MM-DD"` | Calendar date |
| `dailyStats.totalCp` | integer | Weighted tokens today |
| `dailyStats.inputTokens` | integer | Raw input tokens today |
| `dailyStats.outputTokens` | integer | Raw output tokens today |
| `dailyStats.cacheCreationTokens` | integer | 5-min cache write tokens today |
| `dailyStats.cacheCreation1hTokens` | integer | 1-hour cache write tokens today |
| `dailyStats.cacheReadTokens` | integer | Cache read tokens today |
| `dailyStats.sessionCount` | integer | Sessions today |
| `dailyStats.limitHitCount` | integer | Rate-limit hits today |
| `dailyStats.peakPctUsed` | integer | Highest window % today |
| `dailyStats.firstSessionAt` | epoch ms | First activity timestamp today |
| `dailyStats.lastActivityAt` | epoch ms | Last activity timestamp today |
| `dailyStats.prompts` | integer | Prompts submitted today |
| `dailyStats.toolCalls` | integer | Tool calls today |
| `dailyStats.peakHour` | integer (0–23) | Hour with highest token usage |
| `tonight.prompts` | integer | Prompts in current 5h window |
| `tonight.yoloPct` | integer | % of window prompts in bypass-permissions mode |
| `tonight.agentRuns` | integer | Agent/subagent sessions in window |
| `tonight.maxContext` | integer | Largest single context (tokens) in window |
| `tonight.outputTokens` | integer | Total output tokens in window |
| `tonight.cacheReadPct` | integer | % of tokens served from cache |
| `tonight.models` | `{ [modelId]: cpTokens }` | Weighted tokens per model in window |
| `tonight.tools` | `[["Read", 47], ...]` | Tool function names and call counts — names only |
| `tonight.topProject` | string | Project directory basename with most usage in window |
| `tonight.topProjectPct` | integer | % of window CP from that project |
| `tonight.firstPromptAt` | ISO timestamp | First prompt timestamp in window |
| `tonight.timeToCookMins` | integer \| null | Minutes from first prompt to rate-limit hit |
| `tonight.toolErrors` | integer | Tool calls that returned `is_error: true` |
| `tonight.sessionsCount` | integer | Session count in window |

---

### Rate-limit event — once per window, when the limit is hit

| Field | Type | Description |
|---|---|---|
| `cookedAt` | ISO timestamp | When the limit was hit |
| `usedTokens` | integer | Tokens at the time of the hit |
| `limitTokens` | integer | Token ceiling |
| `timeToCookMins` | integer \| null | Minutes from first prompt to hit |
| `topModel` | string | Most-used model in the window |
| `resetsAt` | ISO timestamp | Next window start |

---

### Lifetime stats — weekly, on first sync of the week

| Field | Type | Description |
|---|---|---|
| `totalTokens` | integer | Total weighted CP tokens ever recorded |
| `tenureDays` | integer | Days since first usage entry |
| `prompts` | integer | Total prompt count (all time) |
| `topModel` | string | Most-used model (all time) |
| `models` | `{ [modelId]: cpTokens }` | Lifetime model breakdown |
| `topProject` | string | Most-used project directory basename (all time) |
| `peakHour` | integer (0–23) | Hour with highest historical usage |
| `busiestDay` | `"YYYY-MM-DD"` | Date with the most tokens ever |
| `busiestDayTokens` | integer | Tokens on that date |
| `maxContext` | integer | Largest single context window ever |
| `agentHeavyPct` | integer | % of lifetime tokens from agent turns |

### Historical backfill — once, on `cookd init`

A `dailyStats` object (same shape as the sync table above) for each calendar date with recorded usage. Sent once to populate dashboard history. Never re-sent.

---

## What is never transmitted

- Prompt text — anything typed in a Claude Code session
- Model responses — anything Claude returned
- Code, file contents, or clipboard data
- Tool arguments — what was passed to any tool call
- Full file paths — only directory basenames
- Machine hostname, username, or system identifiers
- Email, name, or any PII — the press-code flow requires none

The companion links via a six-character press code. The `deviceId` is the only persistent identity. The backend has no way to associate usage data with a person.

---

## Supported Versions

| Version | Supported |
|---|---|
| 0.x (current) | yes |

---

## Reporting a Vulnerability

If you find anything that causes the companion to read or transmit content beyond what is listed above, report it privately before opening a public issue.

**Email:** [info@codeclowns.com](mailto:info@codeclowns.com)

Include: a description, steps to reproduce, the version you tested, and whether you believe it is exploitable in practice. We will respond within 72 hours. Confirmed vulnerabilities get a patch and a changelog credit unless you prefer otherwise.

Do not open a public GitHub issue for security vulnerabilities.
