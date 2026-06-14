# Security Policy

## Privacy Statement

**your code and prompts never leave your machine. we take the numbers.**

The cookd companion extracts only non-content fields from local agent transcripts.

**What is read and transmitted:**
- Token counts: `inputTokens`, `outputTokens`, `cacheCreationTokens`, `cacheReadTokens`
- Timestamps from usage entries
- Tool names used during the session (system identifiers: `"Read"`, `"Edit"`, `"Bash"`, etc. — never the arguments)
- Whether a session ran in YOLO / bypass-permissions mode (boolean, not the prompts)
- The directory basename of your current project (e.g., `"cookd"`) — never the full path
- Rate-limit reset timestamps from error entries

**What is never read or transmitted:**
- Prompt content
- Generated code or assistant responses
- File contents or file paths
- Conversation history
- Any string value entered by a user or returned by the model

Local state is stored at `~/.cookd/` with `chmod 600` on all credential files.
The full list of what leaves your machine is readable in
`src/sync/events.ts` and `src/adapters/claude-code/transcript.ts`.

---

## Supported Versions

| Version | Supported |
|---|---|
| 0.x (current) | yes |

---

## Reporting a Vulnerability

If you find a security vulnerability — especially anything that could cause the
companion to read or transmit content beyond numeric token counts — please report
it privately before opening a public issue.

**Email:** [info@codeclowns.com](mailto:info@codeclowns.com)

Include in your report:
- A description of the vulnerability
- Steps to reproduce
- The version of cookd you tested against
- Whether you believe it is exploitable in practice

We will respond within 72 hours. If the vulnerability is confirmed, we will ship
a patch and credit you in the changelog unless you prefer otherwise.

Do not open a public GitHub issue for security vulnerabilities.
