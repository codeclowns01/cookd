# Codebase Architecture: cookd-companion (`@codeclowns/cookd`)

> Derived from: cookd-companion @ `878bd8b` · Last verified: 2026-07-20
> Refresh: if `git rev-parse --short HEAD` matches, trust this; else
> `git diff --name-only 878bd8b..HEAD` and update only affected sections.

## Contents
- Architectural style & layering
- Design patterns in use
- Conventions
- Key abstractions & extension points
- Module / boundary map
- Load-bearing tech debt
- Prior-art index

## Architectural style & layering
Single TypeScript/Node ESM package (`"type": "module"`), published to npm as `@codeclowns/cookd`; `bin.cookd → dist/cli.js`. It is a CLI daemon-ish tool, not a service. Rough layers:
- **Transport / entry** — `src/cli.ts` (commander; lazy-`import()` per subcommand: `init`, `status`, `watch`, `wrapped`).
- **Commands** — `src/commands/*` orchestrate a run (`init.tsx` is an Ink React app; `status.ts`/`watch.ts`/`wrapped.ts` are plain).
- **Adapters (domain read)** — `src/adapters/*`; per-agent transcript readers behind an `AgentAdapter` interface, chosen by `registry.ts`.
- **Sync (domain write)** — `src/sync/*`; SQLite durable queue + HTTP client + the `WindowSummary`/`LifetimeStats` wire types.
- **Auth** — `src/auth/*`; device-link handshake + local credentials.
- **UI** — `src/ui/*`; Ink components + a shared theme (the "field reporter / HOT PRESS" aesthetic).

The build is plain `tsc` (`npm run build`). Release also produces 5 bun-compiled standalone binaries (see tech debt / prior art), but those are **GitHub Release assets, not part of the npm package**.

## Design patterns in use
- **Adapter + registry over agents.** `AgentAdapter` interface (`src/adapters/types.ts:16`) with `detect/events/watch/weightEvent/estimatedLimit`; `detectAdapter()` (`src/adapters/registry.ts`) picks one. `ClaudeCodeAdapter` (`src/adapters/claude-code/index.ts:9`) is the live one; a `cursor` stub exists. **New agents extend here.**
- **Full-rescan read, in-memory dedup.** `adapter.events()` (`index.ts:19`) discovers all project dirs, reads every `*.jsonl` fully (`transcript.ts:parseJsonl`), dedups by `messageId` (`transcript.ts:deduplicateEvents:177`). No byte-offset bookmarks; state is recomputed each call.
- **Single durable outbound queue for window state.** `syncWindowState()` (`src/sync/client.ts:30`) enqueues a `WindowSummary` into `sync_queue` (better-sqlite3, WAL — `src/sync/queue.ts`) then flushes. Backend dedups/idempotently upserts. NOTE: `syncLifetimeStats`/`syncHistoricalStats` POST **directly**, bypassing the queue (`client.ts:47,35`).
- **Client-side aggregation, raw payload to backend.** Weighting/window/lifetime computed locally (`window.ts`, `wrapped.ts`) and POSTed as finished aggregates to `usage-ingest`/`wrapped-sync`.
- **Lazy command loading.** `cli.ts` dynamic-imports each command module on demand.
- **Network resilience wrapper.** `safeFetch()` (`client.ts:7`) maps TLS/proxy/DNS errors to actionable messages; proxy dispatcher set in `cli.ts` from `HTTPS_PROXY`.
- **Windows I/O retry.** `parseJsonl` retries EIO/EBUSY/EPERM 3× on `win32` (`transcript.ts:264`).

## Conventions
- **ESM + `.js` import specifiers** on TS sources (`import ... from './x.js'`).
- **Ink UI is state-machine driven** (`init.tsx` `InitState` union) with a **non-TTY plain fallback** (`runInitPlain`, gated on `process.stdout.isTTY`, also the EIO/EBUSY/EPERM Ink fallback at `init.tsx:408`). Any new interactive flow must ship both.
- **Theme tokens, not raw colors.** Hex constants from `src/ui/theme.ts` (`STAMP`, `MUT`, `FAINT`, `FLAME`, …) via `chalk.hex(...)`; box/receipt/editorial chrome in `src/ui/ink/*` (`Box`, `EditorialBlock`, `PressCode`, `HeatGauge`, `Barcode`, `Ticker`).
- **Local state under `~/.cookd/`** — `credentials.json` (chmod `0o600`), `local.db` (SQLite WAL). `COOKD_DIR` exported from `auth/credentials.ts`.
- **Payload contracts are explicit types** in `src/sync/events.ts` (`WindowSummary`, `LifetimeStats`, `DailyStats`, `Tonight`, `CookedEventPayload`). These define exactly what leaves the machine (see ADR-010).
- **Testing:** Vitest; fixtures in `test/fixtures/claude-code/*.jsonl`; pure functions (`window`, `transcript`, `calibrate`, `wrapped`) are the tested seams.
- **ADRs:** `docs/architecture/decisions/NNN-slug.md`, 3-digit, title `# ADR-NNN: Title`. Manifests: `docs/architecture/manifests/`.

## Key abstractions & extension points
- **`AgentAdapter`** — the seam for multi-agent (Codex/Cursor). New triggers/readers plug in here; keep `cookd sync` agent-neutral.
- **`sync/client.ts` + `sync/queue.ts`** — the outbound path. A headless `cookd sync` should reuse `syncWindowState` (queue+flush) and the existing payload builders, not add a new POST path.
- **`sync/events.ts` types** — the privacy contract surface; anything new that leaves the machine is declared here and governed by ADR-010.
- **`auth/credentials.ts`** — `loadCredentials()` / `isLinked()` are the hooks for a "returning, already-linked device" branch (the re-init guard).
- **`ui/ink/*` + `ui/theme.ts`** — reuse for any new consent/interactive screen; do not introduce a new visual style.

## Module / boundary map
- `src/cli.ts` — entry/routing. Healthy, thin.
- `src/commands/init.tsx` — **overloaded**: device-link handshake + calibration + first sync + full Ink UI in one ~420-line file. Always runs the press-code path (no returning-device branch). The re-init guard and hook-install consent land here or in a sibling module.
- `src/commands/{status,watch,wrapped}.ts` — read/report + the chokidar watch loop.
- `src/adapters/claude-code/*` — discovery (`paths.ts`), read (`transcript.ts`), window math (`window.ts`), lifetime/tonight (`wrapped.ts`), calibration (`calibrate.ts`, `calibration-store.ts`). Healthy boundaries.
- `src/sync/*` — queue, client, wire types. Healthy, but the direct-POST bypass (lifetime/historical) is an inconsistency.
- `src/auth/*` — credentials + device-link. Healthy.
- **New surface (none exists yet):** a Claude Code hook installer that writes `~/.claude/settings.json` and a binary provisioner writing `~/.cookd/bin/`. No prior code touches `settings.json`.

## Load-bearing tech debt
- **`init.tsx` always shows a press code** (`init.tsx:177-196`) — no already-linked branch, so any "just re-sync" path wrongly demands a new code. Blocks the re-init guard until fixed.
- **Two outbound paths** — `syncWindowState` (durable queue) vs. direct POST in `syncLifetimeStats`/`syncHistoricalStats` (`client.ts:35,47`). New sync work should go through the queue, not widen the bypass.
- **No PID lock / single-instance guard** — concurrent `cookd` processes (e.g., parallel `SessionEnd` fires) are unguarded; relies on SQLite WAL + backend idempotency to stay safe.
- **npm package is JS-only** (`package.json:25-33`) while the runnable binaries live on GitHub Releases (`release.yml`) — the split that shapes ADR-011's provisioning decision.
- **`topProject` ships a directory basename** (a content-derived name) — acknowledged in ADR-010; still a counts-not-names gap.
- **Possible drift** with `cookd-app/demo-usage-sim/` ("renamed from the old companion") — reconcile which is canonical.

## Prior-art index
- **ADR-006 auth model** — device token (raw client-side, SHA-256 server-side, Bearer on subsequent calls); `pollForLink` reauth passes the existing token. The re-init guard extends this, not reinvents it.
- **ADR-010 privacy data model** — the enforced read/never-read boundary + `execFile()`-only subprocess rule. Any new read (hook `transcript_path`) and any new subprocess (binary launch) must conform.
- **`safeFetch` + queue flush** — the established resilient-outbound pattern; the binary download at consent should reuse `safeFetch`'s TLS/proxy handling.
- **Ink state-machine + plain fallback in `init.tsx`** — the established pattern for an interactive terminal flow; the consent UI mirrors it.
