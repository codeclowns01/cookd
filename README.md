# cookd

**THE ANTISOCIAL NETWORK.**

Claude slammed the door. You have five hours.

Most developers doomscroll. Some switch to Gemini and feel bad about it. Some just close the laptop and stare at the ceiling. None of them get a roast card.

cookd is the app that prints your failure as a front page. It reads your local token usage, generates a roast written by a sardonic tabloid editor who has studied your specific crimes, and lets you share the damage with whoever will appreciate it most — your Slack, your Discord, your group chat full of developers who have been in exactly the same position.

The companion is what you're looking at right now. It runs on your machine, reads your usage, and ships the numbers to your dashboard. It never touches your code or your prompts. It takes the numbers. That's it.

```
npx cookd init
```

The editor will take it from there.

---

## what happens

You run `npx cookd init`. The companion reads your local Claude Code transcripts — token counts only, never content. It prints your field notes: how many tokens you torched, how fast you burned, what percentage of your window is gone. Then it generates a six-character press code.

You enter the press code in the app. The editor reads your file. A roast card prints. It is specific. It uses your real numbers. It is, depending on your crimes, somewhere between funny and deeply accurate.

You share it wherever your developer community lives. Someone who receives it wants their own. That is the loop.

---

## the companion commands

```bash
npx cookd init       # link this machine to your account
cookd status         # how deep are you right now
cookd watch          # start the background sync
cookd wrapped        # your full usage anatomy
```

---

## privacy

**your code and prompts never leave your machine. we take the numbers.**

The Claude Code adapter reads only token counts from your local JSONL transcripts — `inputTokens`, `outputTokens`, `cacheCreationTokens`, `cacheReadTokens`. It does not read prompt content. It does not read code. It does not read file paths. It does not read project names.

Credentials are stored at `~/.cookd/credentials.json` with `chmod 600`. Nothing is logged to any external service beyond the numeric usage data you explicitly sync.

This is open source. You can read exactly what leaves your machine. That is the point.

---

## the rolling window

Claude Code resets limits on a rolling 5-hour basis. cookd tracks your weighted token spend within that window and shows you what percentage of your limit you've torched.

Token weights: `inputTokens × 1` · `outputTokens × 4` · `cacheCreationTokens × 1.25` · `cacheReadTokens × 0.1`

---

## requirements

Node 22+. A terminal. A Claude Code session history. That last one is the only real requirement.

```bash
# one-time setup
npx cookd init

# global install (for status / watch / wrapped without npx)
npm install -g cookd
```

---

## supported agents

| agent | status |
|---|---|
| Claude Code | stable |
| Cursor | coming soon |
| Windsurf | coming soon |
| Gemini CLI | coming soon |

### add an agent

cookd uses an open `AgentAdapter` interface. If your editor isn't listed, open a PR:

```typescript
export interface AgentAdapter {
  readonly name: string;
  readonly displayName: string;
  detect(): Promise<boolean>;
  events(): Promise<UsageEvent[]>;
  watch(cb: () => void): () => void;
}
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full spec and a worked example.

---

## contribute

Bug reports, feature requests, and adapter PRs are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) first.

---

## license

MIT © 2026 [CodeClowns Technologies LLP](mailto:info@codeclowns.com)

---

*no email. no password. no tourists.*

*if you don't have a terminal, this isn't for you.*
