# Contributing to cookd

cookd is open source because the companion should be auditable, not because we need help building the app. The most valuable thing you can contribute is an agent adapter. Everything else is secondary.

---

## the most valuable contribution: a new agent adapter

The biggest gap in cookd right now is agent coverage. If your editor of choice isn't Claude Code, the companion doesn't know how to read your usage. That is the thing worth building.

### how adapters work

Every adapter implements the `AgentAdapter` interface from `src/adapters/types.ts`:

```typescript
export interface AgentAdapter {
  readonly name: string;           // machine identifier, e.g. "cursor"
  readonly displayName: string;    // shown in UI, e.g. "Cursor"
  detect(): Promise<boolean>;      // returns true if this agent is installed and has data
  events(): Promise<UsageEvent[]>; // returns all usage events, oldest first
  watch(cb: () => void): () => void; // calls cb when new usage data arrives, returns cleanup fn
}

export interface UsageEvent {
  ts: Date;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;    // 5-minute ephemeral cache write tokens
  cacheCreation1hTokens: number;  // 1-hour ephemeral cache write tokens
  cacheReadTokens: number;
  isSidechain: boolean;           // true if this is an agent/subagent turn
  messageId?: string;             // opaque dedup key from the agent
  sessionId?: string;             // groups events within one agent session
  projectName?: string;           // directory basename of the project, never full path
  limitResetAt?: Date;            // set on rate-limit error entries; token fields are 0
  requestId?: string;
}
```

### adding a new adapter

1. Create `src/adapters/<agent-name>/index.ts` — implements `AgentAdapter`
2. Create `src/adapters/<agent-name>/paths.ts` — discovers the agent's local data directory
3. Create `src/adapters/<agent-name>/transcript.ts` — parses the agent's usage format into `UsageEvent[]`
4. Register the adapter in `src/adapters/registry.ts`
5. Add a stub or full implementation — stubs with `detect()` returning `false` are valid to land

The Claude Code adapter at `src/adapters/claude-code/` is the reference implementation. Read it before writing your own.

### adapter rules

- `detect()` must never throw. If the data directory doesn't exist, return `false`.
- `events()` reads local files only. No network calls from an adapter.
- `watch()` uses `chokidar`. Return the cleanup function. Do not leak watchers.
- Adapters read token counts only. If the agent's format includes prompt content, extract only the numeric fields.

---

## running locally

```bash
git clone https://github.com/codeclowns01/cookd
cd cookd
npm install
npm run dev -- init   # runs src/cli.ts init with tsx
npm test
```

Node 22 required.

---

## tests

Tests live in `test/`. Unit tests cover adapter parsing logic and the rolling window math. Run:

```bash
npm test               # single run
npm run test:watch     # watch mode
npm run test:coverage  # coverage report
```

New adapters must ship tests for `transcript.ts` — at minimum: empty input, single event, multiple events, malformed input. Use fixtures in `test/fixtures/<agent-name>/`.

---

## code style

- TypeScript strict mode throughout
- ESM only (`"type": "module"`)
- No default exports
- No comments that explain what the code does — name things well instead
- Short, direct variable names in tight scopes; full names at module scope

---

## pull request checklist

- [ ] `npm run lint` passes (no TypeScript errors)
- [ ] `npm test` passes
- [ ] New adapter or feature has tests
- [ ] `CHANGELOG.md` has an entry under `[Unreleased]`
- [ ] PR description explains what changed and why

Use the PR template. It's short.

---

## bug reports and feature requests

Use the issue templates in `.github/ISSUE_TEMPLATE/`. Give specific details. Vague reports get closed.

---

## what we will not merge

- Changes that read prompt content, file paths, or code from agent transcripts
- Network calls from inside adapters
- Dependencies that don't run on Node 22 LTS
- Features that belong in the app, not the companion

---

## contact

[info@codeclowns.com](mailto:info@codeclowns.com)
