# ADR-011: Auto-refresh the companion via a consented Claude Code SessionEnd hook running a downloaded local binary

- **Status**: Implemented
- **Date**: 2026-07-20
- **Source manifest**: docs/architecture/manifests/companion-refresh-hook-scope-manifest.md
- **Deciders**: Chief Architect (automated pre-development review) + founder (Kanwar)

## Context

Today the companion only pushes usage when the user manually re-runs `npx @codeclowns/cookd`; `init` syncs once and exits, and nothing persists to push. Because the phone app cannot reach the laptop, laptop-side push is the only way data (and — critically — the user's app **access**, which `usage-ingest` recomputes as `access_expires_at`) stays fresh. **Core Wedge:** on consent, install a Claude Code `SessionEnd` hook that runs a headless, pinned, **local** `cookd sync` reusing the existing full-tree scan and existing payloads. Companion-side only — no backend, no app change. See the manifest and `refresh-decision.md`.

## Discovered Code Friction

- `package.json:25-33` — `bin.cookd → dist/cli.js`, `files: ["dist", …]`, `build: tsc`. **The npm package ships JavaScript only; no compiled binary.**
- `.github/workflows/release.yml:43-93` — on `v*` tag, after npm publish a `compile-binaries` matrix produces 5 bun-compiled standalone binaries (linux x64/arm64, darwin x64/arm64, windows x64) and `create-release` uploads them to a **GitHub Release**. The runnable binaries already exist — as release assets, not in npm.
- `src/commands/init.tsx:177-196` — `init` **always** calls `deviceLinkStart` + `pollForLink` (press code), even when valid credentials exist. No returning-device branch.
- `src/auth/credentials.ts:29,50` — `loadCredentials()` / `isLinked()` already exist; sufficient to build the re-init guard with no backend change.
- `src/sync/client.ts:30-33` — `syncWindowState()` enqueues into `sync_queue` then flushes; `client.ts:35,47` — `syncLifetimeStats`/`syncHistoricalStats` POST **directly**, bypassing the queue. Targets are `usage-ingest` / `wrapped-sync`.
- `src/adapters/claude-code/index.ts:19-47` — `events()` does the full-tree scan reused by `cookd sync`; `src/sync/queue.ts` — better-sqlite3 **WAL**, tolerant of concurrent writers.
- **No file under `src/` touches `~/.claude/settings.json`** — the hook installer is a new, self-contained surface.
- `src/commands/init.tsx:329,408` — Ink UI with a `runInitPlain` non-TTY fallback; `src/ui/theme.ts` + `src/ui/ink/*` are the reusable consent-screen chrome.
- Hub (`codebase-map.md`): `usage-ingest` recomputes `access_expires_at` (access coupling); app already re-polls on reopen (ADR 0002 `REOPEN_FLOOR_MS`) → no app change needed.

## Adversarial Review Debate

**Pragmatic Systems Architect —** Add a headless `cookd sync` that reuses `adapter.events()` (`index.ts:19`) and `syncWindowState` (`client.ts:30`, queue+flush). Install a `SessionEnd` hook into `~/.claude/settings.json` invoking a pinned local binary at `~/.cookd/bin/cookd`. Reuse the existing `sync_queue` (WAL) for durability. Nothing new leaves the machine, so no backend/app change.

**Cynical Principal Critic —** The npm package is JS-only (`package.json:25`). Where does that "local binary" come from? Bundling all five bun binaries into the tarball balloons every `npx` signup by hundreds of MB — worse than the bug.

**Architect —** Don't bundle. The release pipeline already builds and uploads exactly those five binaries to a GitHub Release (`release.yml:43-93`). At consent, download the **one** matching the user's os/arch to `~/.cookd/bin/cookd`. npm package stays JS-only; the download is one-time, at a moment the user is online and present.

**Critic —** Downloading a binary and then auto-executing it every session is a remote-code-execution surface. A hijacked release or a MITM turns "auto-run cookd" into "auto-run anything," and unlike manual invocation it fires unattended forever (blast radius).

**Architect —** Mitigated, not eliminated: pin the version, **checksum-verify** the download against a checksums file published in the release, fetch over TLS via the existing `safeFetch` (`client.ts:7`, already handles proxy/SSL-inspection). It is your own provenance-built artifact, and the user already extends this trust by running `npx`. Easy `cookd uninstall` and open source bound the residual. Accepted as risk R7.

**Critic —** `cookd sync` doing a full-tree scan (`index.ts:19`) on *every* `SessionEnd`, and parallel `SessionEnd` fires from multiple projects, means concurrent full scans plus concurrent full-`WindowSummary` POSTs. Do they race on `sync_queue`, and is the redundant work wasteful?

**Architect —** At the manifest's **Modest** envelope (tens of projects, <100 files, <50MB) a full scan per session-end is bounded. `sync_queue` is WAL (`queue.ts`), which tolerates concurrent writers; `usage-ingest` upserts are idempotent snapshots, so redundant concurrent syncs converge rather than corrupt. No coalescing needed now; the named re-architecture trigger (read only the hook's `transcript_path`) applies if usage reaches Heavy.

**Critic —** `SessionEnd`-only doesn't extend access mid-session. `usage-ingest` recomputes `access_expires_at`; a long or low-token session fires no sync until it ends, so an actively-coding user can hit the Lock screen — the exact failure this feature exists to prevent.

**Architect —** Real, and founder-accepted as carried risk **R1**. `SessionEnd`-only is still strictly better than today's manual-only. A cheap mitigation exists within scope — also install a `SessionStart` hook so access refreshes at the *start* of each session — which the implementation plan should weigh. Per-turn (`Stop`) stays deferred.

**Critic —** Nobody writes `~/.claude/settings.json` today. A careless merge corrupts a file Claude Code owns and may itself rewrite — and `init` always shows a press code (`init.tsx:177`), so a returning user re-running to refresh gets wrongly asked for a new code.

**Architect —** The installer is a self-contained module: parse-or-abort, back up, add-only merge, atomic temp+rename; `cookd uninstall` removes only cookd's block; detect managed-policy/unparseable and inform. The re-init guard uses the existing `loadCredentials()` (`credentials.ts:29`) — valid creds → skip `deviceLinkStart`, run `cookd sync` directly. No backend change.

**Convergence —** Scope holds (no smaller wedge forced). The Critic extracts hard constraints: checksum-verified pinned download over `safeFetch`; a safe `settings.json` merge module; the re-init guard; and two documented, non-blocking carries — **R1** (access lapse under SessionEnd-only, with the `SessionStart` mitigation to evaluate) and the **Heavy-scale** re-architecture trigger (switch to `transcript_path`-only reads + backend accumulation).

## Decision

Ship a companion-only auto-refresh built from five parts:

1. **`cookd sync`** — a new headless subcommand: reuse `ClaudeCodeAdapter.events()` full scan (`index.ts:19`) and push via the existing `syncWindowState` queue+flush path (`client.ts:30`) with the existing `WindowSummary`/`LifetimeStats` payloads. **No new outbound path, no backend change.** Invoked by the hook and by the returning-device manual path.
2. **`SessionEnd` hook install (consented)** — write a hook block into `~/.claude/settings.json` calling `~/.cookd/bin/cookd sync` by absolute path. Parse-or-abort, back up, add-only merge, atomic write. Also evaluate a `SessionStart` hook for R1.
3. **Binary provisioning = option A1: download from the release file host at consent.** Detect os/arch, download the one matching binary produced by `release.yml` (GitHub Releases now; a swappable URL — own host/CDN later), **checksum-verify**, chmod, store at `~/.cookd/bin/cookd`. The npm package stays JS-only. Rejected: bundling all 5 in the tarball (bloats every `npx` signup); per-platform `optionalDependencies` sub-packages (correct at scale, disproportionate publish machinery for beta — the documented A3 upgrade path); local JS install (native-module ABI fragility at hook time); `npx`-in-hook (network + auto-latest every session).
4. **Re-init guard** — `init` checks `loadCredentials()`; valid creds → skip the press-code handshake and sync silently (`init.tsx:177` fix). Press code only for a new/unlinked device.
5. **Consent + uninstall UX** — reuse the Ink theme/components (`ui/ink/*`, `ui/theme.ts`) with a `runInitPlain`-style plain-TTY fallback; `cookd uninstall` removes the hook block and the binary; non-interactive contexts never auto-install.

## System Consequences

- **Freshness/access:** a sync fires at every session end → `access_expires_at` refreshes without manual runs; strictly better than today. New failure mode: access can still lapse *within* a long/low-token session (R1) until/unless the `SessionStart` mitigation or per-turn timing is added.
- **Cost:** DB writes scale with real activity (idle users cost nothing) — cheaper than any always-on daemon. One-time ~50–90 MB binary download per consenting user at signup; ~50–90 MB resident in `~/.cookd/bin/`. No per-session network beyond the sync POST.
- **New operational surface:** the companion now writes `~/.claude/settings.json` (a file it did not previously touch) and executes a downloaded binary — new corruption and supply-chain surfaces, bounded by safe-merge + checksum + uninstall (R2, R7).
- **Concurrency:** parallel `SessionEnd` fires run parallel full scans + snapshot POSTs; safe via WAL + idempotent `usage-ingest` upserts, wasteful only at scale (Heavy-scale trigger).
- **No backend, no app change:** identical payloads to identical endpoints; the app already re-polls on reopen.
- **Distribution coupling:** ties the hook to a release-hosted binary URL (swappable); does not touch the phone app's app-store distribution.

## Conventions & Patterns for Implementation

- **Follow** the outbound-queue pattern — route `cookd sync` through `syncWindowState`/`sync_queue` (`client.ts:30`, `queue.ts`); do **not** widen the direct-POST bypass (`client.ts:35,47`).
- **Follow** the privacy contract (ADR-010): `cookd sync` reads only what `transcript.ts` already reads; the hook’s `transcript_path` input is a path, not content; any subprocess uses `execFile()` with an argument array, never a shell string.
- **Follow** the Ink state-machine + `runInitPlain` non-TTY fallback pattern for the consent screen; use `ui/theme.ts` tokens and `ui/ink/*` chrome — no new visual style.
- **Extend** `loadCredentials()`/`isLinked()` (`credentials.ts`) for the re-init guard; extend `safeFetch` (`client.ts:7`) for the checksum-verified binary download (TLS/proxy handling reused).
- **Isolate** the `settings.json` writer and the binary provisioner in their own modules (no prior art to extend); keep `cookd sync` agent-neutral so Codex/Cursor triggers are additive later.
- **Avoid** bundling binaries into the npm package; avoid `npx` in the hook; avoid a full re-read/incremental redesign (Modest scale — reuse the existing full scan); avoid touching `topProject` here (tracked separately).

## Acceptance Criteria

- [ ] `cookd sync` exists as a headless subcommand; produces the same `WindowSummary`/`LifetimeStats` payloads and routes window state through `sync_queue` (no new POST path, no backend change).
- [ ] On consent, exactly one os/arch-matched binary is downloaded from the release host, **checksum-verified**, and written to `~/.cookd/bin/cookd`; failure/offline defers install and informs the user (never a silent partial install).
- [ ] A `SessionEnd` hook calling `~/.cookd/bin/cookd sync` by absolute path is written to `~/.claude/settings.json` via back-up + add-only merge + atomic write; a pre-existing unparseable file aborts with a message; managed-policy block is detected and reported.
- [ ] `cookd uninstall` removes only cookd's hook block and the binary, leaving the rest of `settings.json` intact.
- [ ] Re-running the command on an already-linked device (valid `credentials.json`) syncs without showing a press code (`init.tsx` returning-device branch).
- [ ] Consent + uninstall screens reuse `ui/ink/*` + `ui/theme.ts` and have a plain-TTY fallback; non-interactive invocation never auto-installs.
- [ ] The npm package still ships JS only (no binaries added to `files`).
- [ ] R1 (access lapse under SessionEnd-only) is addressed or explicitly deferred in the plan, with the `SessionStart`-refresh option evaluated.

## Revision History

<Omit — fresh ADR.>

## Next Step

This ADR is a design decision, not an implementation plan. Next: write an implementation plan against it, then `/plan-eng-review` and `/plan-design-review`.

## Conformance Check

**2026-07-21** — `/chief-architect-verify` on branch `feat/companion-refresh-hook` (impl commits `b127b35` + `f98d6f3`). 92 tests pass, `tsc --noEmit` clean.

**Score: 13/16 checkable claims fully implemented (~81%). No Core-Wedge claim missing. Verdict: 🟡 Implemented with deviations.**

Implemented as decided (✅): AC1 (`cookd sync` reuses `syncWindowState`/`sync_queue`, no new POST — `run.ts:77`), AC2 (checksum-verified binary → `~/.cookd/bin`, graceful deferral — `binary.ts`, `init.tsx offerAutoSync`), AC4 (`uninstall` removes only cookd's block+binary by command-path), AC5 (re-init guard — `init-guard.ts` + both `init.tsx` paths), AC7 (npm `files` still `dist`-only), AC8 (**exceeded** — both `SessionStart`+`SessionEnd` installed, so R1 closed not merely deferred), eng deltas D1–D4, design deltas DD1/DD3/DD4.

Deviations (for conscious accept or follow-up):
- **🔻 Binary download uses raw `fetch`, not `safeFetch` (unstated).** `binary.ts:44-45`. `safeFetch` (proxy/TLS-inspection handling, `client.ts:7`) is not exported and was not reused — corporate-proxy users may get an unhelpful error on the ~60MB download. Recommended fix before merge: export `safeFetch`/shared util and use it.
- **🔻 Managed-policy not detected (AC3, unstated).** `settings.ts` has no `allowManagedHooksOnly`/`disableAllHooks` check; the write mechanics (backup + add-only merge + atomic + unparseable-abort) are fully implemented, but an enterprise-blocked hook installs silently and never fires. Implement detection or explicitly defer.
- **⚠️ Consent renders via chalk, not Ink `Box` chrome (AC6/DD2, reason stated).** Both flows unified and `useInput` risk avoided; theme colors (`consentColorFor`) + legible-edit treatment + plain-TTY fallback + non-interactive-no-install (tested) all preserved; only the box framing was dropped.

This ADR is the living record: `/chief-architect-verify` sets Status → Implemented with deviations.

**2026-07-21 (re-verify)** — `/chief-architect-verify` re-run after the deviations were resolved. **Score: 16/16 in-scope claims implemented. Verdict: 🟢 — safe to merge (architecture conformance).** Status flipped → **Implemented**.

Disposition of the three prior deviations:
- **`safeFetch` for the binary download — FIXED** (`87da72a`). `safeFetch` exported from `client.ts:7`; `binary.ts:47-48` uses it, so the ~60MB download shares the sync client's proxy/TLS-inspection error handling.
- **Managed-policy / enterprise-block detection — CONSCIOUSLY DESCOPED** (founder, 2026-07-21). Out of scope for now; enterprise managed-hook environments are not a target audience yet. The `settings.json` write mechanics (backup + add-only merge + atomic + unparseable-abort) remain fully implemented. Revisit if/when enterprise becomes a target.
- **Consent renders via chalk-colored terminal lines, not Ink `Box` chrome — INTENDED DESIGN** (founder, 2026-07-21). The thin terminal look is what the founder wants kept. AC6 is satisfied: theme tokens (`consentColorFor` → STAMP/MUT/FAINT), plain-TTY fallback, and non-interactive-no-install (tested) are all in place; the box-framing expectation from DD2 is retired by decision.

No unstated divergence remains. Still-open items are pre-existing and unrelated to this ADR: `topProject` folder-name leak (ADR-010) and `demo-usage-sim` drift.
