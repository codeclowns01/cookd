# Codebase Architecture: cookd-companion (`@codeclowns/cookd`)

> Derived from: cookd-companion @ `bd3a590` · Last verified: 2026-08-18
> Refresh: if `git rev-parse --short HEAD` matches, trust this; else
> `git diff --name-only bd3a590..HEAD` and update only affected sections.
> Incremental refresh 2026-08-18 (ADR-012 device-link recovery pass): marker `e6c6b65`→`bd3a590`
> (PRs #8–#10 — 15-min buckets, growth gate, `Stop` hook, health self-report, release/npm fixes).
> Sections updated: **Load-bearing tech debt** (one item REOPENED BY DESIGN, four new findings) and
> **Prior-art index**. Cross-repo config drift recorded for the first time.
> Incremental refresh 2026-07-27 (cookd-app ADR 0009 pass, Sync Architecture E): marker
> 878bd8b→e6c6b65 (PR #7 — ADR-011 refresh hook landed: `hooks/*`, `sync/run.ts`,
> `commands/{sync,uninstall,init-guard}`, `ui/ink/Consent.tsx`). Sections updated below:
> one tech-debt item is now CLOSED, two new findings added, and the hook-schema question
> that ADR-011 left unverified is now **empirically resolved**.

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
- ⚠️ **`init.tsx` always shows a press code — REOPENED BY DESIGN 2026-08-18 (ADR-012).** PR #7 closed this with `shouldSkipPressCode`; that guard turned out to withhold cookd's **only credential**, permanently locking out users whose app session was lost while their backend link stayed healthy. The code is now unconditional and `isAlreadyLinked()` may never gate control flow again. **Do not "fix" this back.** See ADR-012; ADR-011 #4/AC5 superseded.
- ✅ **Defect B2 (already-linked users never offered the auto-sync hook)** — resolved by the `'resynced'` outcome. ADR-012 preserves it on the expired-code path, but note the Ctrl-C hazard below.
- 🔴 **`pollForLink` silently wipes both sync watermarks (verified 2026-08-18).** `auth/device-link.ts:74-79` builds a fresh **4-field** `Credentials` while the interface (`credentials.ts:6-14`) has **six** — `lastWrappedSync` and `lastCookedEventSentAt` are dropped, then `saveCredentials` overwrites. `watch.ts:40` keys off `!lastWrappedSync` → full lifetime re-push via the direct-POST bypass. **Was dormant only because the re-init guard kept linked devices away from `pollForLink`;** removing that guard wakes it. Fix: spread existing creds, and thread `runSyncOnce`'s returned `creds` forward.
- 🔴 **`runSyncOnce` collapses four outcomes into one boolean.** `sync/run.ts` returns `{synced:false}` **without throwing** for no-adapter (`:32`), unchanged signature (`:41`), growth gate (`:63`) and push rejected (`:133`). `sync/client.ts:94` already computes the real `PushOutcome` and `run.ts:126` already persists it (`gate.ts:35`) — the signal exists and is thrown away at the boundary, so `init` prints `synced.` after zero network calls. With the ADR-011 hooks installed (now the default population) gate 1 returns before any HTTP.
- 🔴 **`pollForLink`'s 10-minute default is awaited unconditionally** (`device-link.ts:60`). On the relink path this blocks a healthy `init` for ten minutes; in non-TTY (CI, piped, or the EIO/EBUSY/EPERM fallback) it hangs with no countdown and no way to answer. Ctrl-C — the rational TTY response — skips `offerAutoSync`, functionally reintroducing B2.
- 🔴 **The dual Ink/plain flow in `init.tsx` has drifted three times.** Most recently within one diff: the Ink path swallowed the resync result entirely while the plain path printed `synced.`; banner copy and handle casing diverged. There is no shared function — copy lives as duplicated literals across JSX and `chalk` calls. ADR-012 mandates one shared decision function in `init-guard.ts`.
- 🔴 **Cross-repo: `cookd-app/supabase/config.toml` contradicts the deployed state.** It sets `verify_jwt = false` for only `usage-ingest` and `public-rapsheet`, yet this CLI calls `device-link-start` with a non-JWT `cookd_` bearer (`device-link.ts:21`) and `device-link-status` with no auth header (`:38`), and both work in production. Redeploying `device-link-start` from that repo could re-enable verification and **break linking product-wide**. Verify against the dashboard before any edge-function deploy.
- ⚠️ **Reuse hazard — never write `devices.last_seen` from a new path.** It has two writers (`usage-ingest:270`, `wrapped-sync:79`) meaning "this token was used", and `0024_limit_states_view.sql:296` orders by it to choose which device represents the user in `Recovery.tsx`'s diagnosis. A third writer poisons that selection.
- 🔴 **`resets_at` / `window_start` are written `NULL` on every sync (verified 2026-07-27).** `run.ts:42-43,55-56` send ISO **strings**; `usage-ingest/index.ts:70-71`'s `toIso` returns non-null only for `typeof ms === "number"`. Cross-repo contract mismatch, silent, live in production. Journal defect B1.
- 🔴 **Subagent transcripts are never read (verified 2026-07-27).** `paths.ts:9-19` reads exactly one directory level and `jsonlFilesIn` does not recurse. Consequence: `tonight.agentRuns` and `agentHeavyPct` are structurally always 0, and ~8% of real usage machine-wide (21% in agent-heavy sessions) is uncounted. Journal defect B3.
- ✅ **RESOLVED — the hook exec-form question ADR-011 could not verify.** Probed the shipped `claude.exe` (v2.1.220) directly: its schema contains `args` — *"Argument list for exec form. When present, `command` is resolved as an executable and spawned directly with these arguments — no shell"* — and `async` — *"If true, hook runs in background without blocking"* (plus a newer `asyncRewake`). **`settings.ts:48`'s existing shape is correct; do not "fix" it into a shell string.** Residual risk: both fields are publicly undocumented, confirmed only for v2.1.220, and no Claude Code version floor is pinned anywhere — an older build could yield a silently no-op hook.
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
- **ADR-012 device-link recovery** — the press code is the product's **only** credential, so any branch that withholds it is an account-recovery outage. Establishes two invariants for link-state reads: **pure read** (no writes to `devices`) and **non-fatal** (a failed check degrades to printing the code, never to withholding it). Also the prior art for *extending an existing endpoint's response rather than adding a probe endpoint* — `device-link-start` already performs the lookup, so folding the answer in removes a failure mode instead of adding one.
- **`device-link-confirm`'s reauth branch** (`cookd-app`) — checks `session.user_id` before the app's JWT and mints tokens for the **laptop's** account, which `Entrance.tsx` `setSession()`s. This is the recovery mechanism; the app adopts the laptop's identity, not the reverse.
