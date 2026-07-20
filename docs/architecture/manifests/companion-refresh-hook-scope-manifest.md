# Technical Scope Manifest: Companion auto-refresh via Claude Code SessionEnd hook

- Date: 2026-07-20
- Status: Ready for review
- Source brief: `refresh-decision.md` (repo root) — no upstream Product Definition Brief in the hub; this feature is a technical mechanism, and `refresh-decision.md` is the accepted brief-equivalent (problem, decision, mechanics, alternatives, risks, multi-agent plan, scope).

## From the Brief (do not re-derive)
- **JTBD:** a cookd user wants their app to reflect their current Claude usage without having to re-run a terminal command. Today the companion only pushes when the command is run manually, so data (and — see below — app *access*) goes stale between runs.
- **Edge:** trust-first — auto-sync must be consented, transparent, and read only structural stats (never prompts/code).
- **Core Wedge (as written):** auto-trigger a sync from a Claude Code `SessionEnd` hook that runs a headless local `cookd sync`, reusing the existing full-tree scan and existing payloads. Companion-side only; no backend or app changes. See `refresh-decision.md` for full mechanics, the consent flow, the settings.json edit, and the risk table.

## Repo Context Found
- **This repo (`cookd-companion`):** the published `@codeclowns/cookd` CLI. TypeScript/Node, Ink terminal UI (`ui/ink/*`, `ui/theme.ts`), `better-sqlite3` (WAL) queue (`sync/queue.ts`), `chokidar` watcher, an adapter pattern (`adapters/{claude-code,cursor}`), commands `init`/`status`/`watch`/`wrapped`. Sync payloads (`WindowSummary`, `LifetimeStats`) POST to `usage-ingest`/`wrapped-sync` (`sync/client.ts`). Read live this session; current.
- **From hub (`product-hub/cookd`, codebase-map @ HEAD `71b63bc`, verified 2026-07-12 — treat as a confirm, re-verify before trusting):**
  - **App already re-polls on reopen** — ADR 0002 `pastRefetchFloor` / `REOPEN_FLOOR_MS = 2 min` in `cookd-app`. Confirms the app side needs **no change**; companion push-freshness is the sole bottleneck.
  - **Access coupling (load-bearing):** `usage-ingest` recomputes `access_expires_at` on each sync; `useMe` gates the app on it (expired → Lock screen). Grants are linear 5→60 min by usage, "until reset" when cooked, 30-min new-user welcome, extend-only within a window. **So stale sync = lockout, not just a stale label.** This reframes the wedge from cosmetic freshness to "keep the user synced-and-unlocked while they code."
- **Drift note (not interviewed, flagged for `-decide`):** `cookd-app` contains `demo-usage-sim/` ("renamed from the old companion"). This repo is the published package. The two may have diverged; reconcile which is canonical before shipping companion changes.

## Performance / Scale Envelope
- **Founder answer: Modest.** Worst-case heavy user ≈ tens of projects, <100 session files, largest transcript <50MB.
- **Consequence:** a **full-tree scan on every `SessionEnd` sync is acceptable indefinitely** at this envelope. No need to read only the hook-provided `transcript_path`; **backend accumulation stays OUT of scope.**
- **Re-architecture trigger (named):** if real usage reaches "heavy" (hundreds of files / multi-hundred-MB transcripts), or if sync timing later moves to per-turn (see risk R1 below), switch to reading only the one `transcript_path` Claude provides — which pulls backend accumulation back into scope. Not now.

## Data-Consistency Tolerance
- **Stale-tolerant / eventually-consistent by construction** — not interviewed because it's derivable: `usage-ingest` upserts are idempotent snapshots, delivery is at-least-once via the existing `sync_queue`, and the `watch` loop already sends repeated `WindowSummary` snapshots the backend absorbs. A missed or duplicated sync self-heals on the next one.
- **The one sharp failure mode is not staleness but access-lapse** (below), which is a *timing/coverage* question, handled in scope decisions, not a consistency-model question.

## Core Wedge
Confirmed and slightly reframed by the access-coupling finding:

> **Keep a cookd user automatically synced-and-unlocked while they use Claude Code** — by installing (on consent) a `SessionEnd` hook that runs a headless, pinned, local `cookd sync`, which reuses the existing full-tree scan and existing payloads. **Companion-side only.**

**Cut to reach the smallest shippable slice:**
- Per-turn (`Stop`) and periodic keep-alive timing — **cut** (SessionEnd only; see R1).
- Transcript-only incremental reads + backend accumulation — **cut** (Modest envelope; full scan reused).
- Any backend or app/UI change — **cut** (not needed).
- Codex/Cursor adapters and triggers — **cut** (deferred; `cookd sync` stays agent-neutral so they're additive).
- The `topProject` folder-name privacy leak — **tracked separately**, not folded in.

**Decisions made this stage (founder answers):**
1. **Sync timing = `SessionEnd` only.** Strictly better than today's manual-only. Access-lapse during long/low-token sessions accepted as a carried risk (R1).
2. **Binary provisioning = bundle the platform binary in the npm package**, copied to `~/.cookd/bin/cookd` at consent; hook references it by absolute path. Implies publishing per-platform binaries (bun compile already produces them) and a larger package; no download/offline-failure path to build.
3. **Scale = Modest** → full-scan-per-sync; no incremental/backend work.

## Open Questions / Risks Flagged for Review
Hand these to `/chief-architect-decide`:
- **R1 — Access-lapse under SessionEnd-only (carried risk, founder-accepted).** A long or low-token session fires no sync until it ends, so `access_expires_at` can lapse mid-session and Lock an actively-coding user. Trigger to revisit: field reports of mid-session lockouts → add `Stop` (per-turn) or a periodic keep-alive. `-decide` should note whether any cheap mitigation fits within SessionEnd-only (e.g., also hook `SessionStart` to refresh access at the start of each session).
- **R2 — `settings.json` write safety.** Must parse-or-abort, back up, merge-not-overwrite, atomic write. `-decide` picks the concrete mechanism and the behavior when the user's existing file is unparseable or managed-policy-locked (`allowManagedHooksOnly` / `disableAllHooks`).
- **R3 — Re-init guard fix.** Re-running the signup command on an already-linked device must sync silently (no new press code). `-decide` confirms the credential-validity branch and that it uses the existing device token (no backend change).
- **R4 — Binary lifecycle.** Bundled binary must match the running package version; define when it's (re)installed (e.g., every signup run) and how uninstall removes both hook and binary.
- **R5 — Concurrency.** Parallel `SessionEnd` fires (multiple projects) launch parallel `cookd sync` processes each doing a full scan + full-snapshot POST. Confirm WAL + queue tolerate it and whether any coalescing is warranted (likely not at Modest scale).
- **R6 — UI parity.** Consent + "exact edits" screens must reuse the existing Ink system (theme palette, box components, editorial/receipt treatment) with a plain-TTY fallback. Design detail → also route to `/plan-design-review`.
- **R7 — Blast radius (honest, permanent).** Automation runs the binary silently on every session; a future compromised release auto-executes. Mitigated by pinned local binary (never npx), easy uninstall, open source. `-decide` should keep these invariants.
- **Carried from brief:** `topProject` sends a raw folder name (counts-not-names violation) — fix independently.
