# Security Policy

## Privacy Statement

**your code and prompts never leave your machine. we take the numbers.**

The cookd companion reads only token counts from local agent transcripts:
`inputTokens`, `outputTokens`, `cacheCreationTokens`, `cacheReadTokens`.

It does not read:
- prompt content
- generated code
- file paths
- project names
- conversation history
- any string field from agent transcripts

Local state is stored at `~/.cookd/` with `chmod 600` on all credential files.
Nothing in that directory is synced. Only the numeric usage events you explicitly
trigger via `cookd watch` or `cookd init` are transmitted.

This is open source. The full list of what leaves your machine is readable in
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
