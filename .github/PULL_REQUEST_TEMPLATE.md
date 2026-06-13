## what this does

<!-- One paragraph. What changed and why. -->

## type of change

- [ ] bug fix
- [ ] new agent adapter
- [ ] new feature
- [ ] refactor
- [ ] docs

## checklist

- [ ] `npm run lint` passes
- [ ] `npm test` passes
- [ ] new code has tests
- [ ] `CHANGELOG.md` updated under `[Unreleased]`

## adapter checklist (adapter PRs only)

- [ ] implements full `AgentAdapter` interface
- [ ] `detect()` never throws
- [ ] `events()` makes no network calls
- [ ] `watch()` returns cleanup function
- [ ] reads token counts only — no prompt content, no code, no file paths
- [ ] tests cover: empty input, single event, multiple events, malformed input
- [ ] registered in `src/adapters/registry.ts`
