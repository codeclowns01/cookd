# refresh-decision.md

**Decision record — how cookd keeps "last sync" fresh**
Status: **Accepted** · Stage: **Beta (live users)** · Scope: **Companion (CLI) only**
Last updated: 2026-07-20

> **Pipeline artifacts (this is the narrative brief; the locked engineering record is the ADR):**
> - Scope manifest: `docs/architecture/manifests/companion-refresh-hook-scope-manifest.md`
> - **ADR: `docs/architecture/decisions/011-companion-refresh-hook.md` (Accepted)** — governs on any conflict.
> - Deep architecture: `docs/architecture/CODEBASE-ARCHITECTURE.md`
>
> **Finalized after recon:** binary provisioning = **download the matching prebuilt binary from the release file host at consent** (option A1), *not* bundled in the npm package — recon found the npm package ships JS only while the 5 bun-compiled binaries already live on GitHub Releases (`release.yml`); bundling all 5 would bloat every `npx` signup. Sync timing = **`SessionEnd` only** (access-lapse during long sessions is carried risk R1; evaluate a `SessionStart` refresh in the plan).

---

## 0. TL;DR

- **Problem:** the app's "last sync" only updated when the user *manually* re-ran `npx @codeclowns/cookd`. Between runs, pull-to-refresh changed nothing.
- **Root cause:** the companion has no persistent process. `init` syncs once and exits. The command *is* the only thing that ever pushes data. The phone can never reach the laptop to pull fresh usage — something on the laptop must push.
- **Decision:** auto-trigger a sync from a **Claude Code `SessionEnd` hook**. When a Claude session ends, Claude itself runs `cookd sync` in the background.
- **Blast radius of the change:** **companion-side only.** No backend changes. No app/UI changes. No data points lost.
- **Multi-agent (Codex, Cursor):** deferred. Hooks do not block it — the *trigger* and the *reader* are separate concerns. Claude Code only, for now.

---

## 1. The problem, precisely

When a user runs the signup command (`npx @codeclowns/cookd`), it runs `init`, which:

1. Reads their Claude usage from disk,
2. Shows a 6-digit press code, links the device,
3. Pushes the current usage to the backend **once**,
4. **Exits. Nothing keeps running.**

The only *other* thing that syncs continuously is a separate `watch` command that a normal user never runs and which only lives while its terminal stays open.

**Therefore: "last sync time" = "last time the command ran."** That is the entire bug.

### Reproduction that confirmed it
- Old user opens app → "last sync 3 days ago" (last time the command ran).
- Pull to refresh → no change (nobody uploaded anything new; backend still has the 3-day-old data).
- Sign out, re-run the command, enter a new code → still "3 days ago" at first → refresh → suddenly correct (because re-running triggered a fresh one-time push).

Every observation is explained by one fact: **only running the command pushes data.**

### The wall we cannot move
The phone (app) and the laptop (where Claude runs) are different machines. The app pulling to refresh can only **re-download whatever the laptop last uploaded**; it cannot reach into the laptop and read fresh Claude usage. **Something on the laptop must push.** This constraint shapes every option.

---

## 2. The decision

Use a **Claude Code `SessionEnd` hook** to auto-trigger a sync.

- Claude Code is already running whenever the user codes.
- When a session ends, Claude Code executes a command we registered — `cookd sync` — which reads the just-finished session and pushes to the backend, then exits.
- No always-on process. Nothing runs when the user isn't using Claude.

**Freshness contract chosen: "fresh after any Claude use."** If the user hasn't touched Claude, stale is acceptable — their numbers genuinely have not changed. The failure we're fixing is "used Claude for 3 days, app still stale," which hooks eliminate because a sync fires at the end of every session.

The behavior we once called the bug — *"init syncs once and exits"* — is actually the correct primitive. A one-shot "read → push → exit" is exactly what a hook should fire. The only real problem was that **only the user, manually, could pull the trigger.** Hooks let Claude pull it automatically, at the right moment.

---

## 3. How Claude Code hooks work (verified against official docs)

A hook is a command registered in a settings file that Claude Code runs itself at a lifecycle event.

- **Where configured:** `~/.claude/settings.json` (the global file — applies across all the user's projects). Other valid locations exist (project `.claude/settings.json`, local, managed policy) but global is correct for us.
- **How it fires:** Claude spawns the command and pipes a **JSON payload on stdin** that includes `session_id`, **`transcript_path`** (the exact `.jsonl` for the session that just ran), `cwd`, and `hook_event_name`. So the hook is *told* which file to read.
- **`SessionEnd`** reason values: `clear`, `resume`, `logout`, `prompt_input_exit`, `bypass_permissions_disabled`, `other`.
- **Exit codes:** `0` = success; `2` = blocking error (irrelevant for us — we never block); other = non-blocking error, shown in transcript. Our hook is fire-and-forget: exit 0, do the work.
- **`async: true`** runs the command detached so it never delays or hangs Claude's UI.
- **Timeout:** configurable per hook; we set a short one (e.g. 30s) as a safety valve.
- **Security gate:** **there is none for settings-file hooks.** Claude Code does *not* prompt the user to approve a newly added hook. This means the transparency/consent duty is entirely **ours** (see §6).
- **Managed environments:** enterprise admins can set `allowManagedHooksOnly` or `disableAllHooks`, which can block our hook. We detect and inform in that case.

### The exact block we add to `~/.claude/settings.json`

```json
{
  "hooks": {
    "SessionEnd": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "/absolute/path/to/.cookd/bin/cookd sync",
            "async": true,
            "timeout": 30
          }
        ]
      }
    ]
  }
}
```

`command` is an **absolute path to a locally-installed binary**, never `npx` (see §5).

---

## 4. What changes — the full companion-side inventory

Everything here is in the CLI package. Nothing on the server or app.

1. **New `cookd sync` subcommand (headless).** The existing sync logic minus the terminal UI: scan → compute → push → exit. It reuses the **existing full-tree scan** and the **existing payloads** (`WindowSummary`, lifetime). It is invoked by the hook, not typed by the user.
2. **Consented hook install.** During the existing signup flow, if the user says yes, cookd:
   - **Downloads** the one os/arch-matched prebuilt binary from the release file host, **checksum-verifies** it, and writes it to `~/.cookd/bin/cookd` (offline/failure → defer install + inform; never a silent partial install),
   - **Backs up** `~/.claude/settings.json` first,
   - **Merges** the hook block in (never overwrites existing settings/hooks),
   - Writes atomically (temp file + rename),
   - Shows the exact line it added.
3. **`cookd uninstall`.** Removes *only* cookd's hook block, leaving the rest of `settings.json` intact.
4. **Re-init guard fix.** Re-running the signup command on an **already-linked** device must **sync silently with no new press code**. (Today `init` always runs the device-link handshake and shows a code — that is wrong for a returning user.) A press code is only for linking a *new* device or recovering wiped/corrupted credentials.

### Config / files touched on the user's machine
| File | Change | Safety |
|---|---|---|
| `~/.claude/settings.json` | Add one `SessionEnd` hook block (on consent) | Backup + merge-not-overwrite + atomic write |
| `~/.cookd/bin/cookd` | Download os/arch binary from release host (checksum-verified) | New file in cookd's own dir (~50–90 MB, once) |
| `~/.cookd/credentials.json` | Unchanged (existing device token) | — |
| `~/.cookd/local.db` (SQLite queue) | Unchanged mechanism | WAL already handles concurrent access |

---

## 5. Why a local binary, not `npx`

- **`npx`** = fetch-then-run: checks the npm registry (network), may download the latest version, then runs. Slow to start, needs the network, and tends to pull *latest* each time.
- **Local binary** = already-present code: runs instantly, offline-safe, and **pinned** to the version the user installed.

The hook runs automatically on **every session end**. If it called `npx`, every session would hit the network and could silently auto-pull new code that then runs on its own — slow, and the exact supply-chain risk in §7. A pinned, self-contained binary (the `bun compile` artifact your `release.yml` already builds) referenced by **absolute path** runs instantly, needs no Node/`node_modules`/PATH at hook time, and is pinned to the installed version.

**How the binary gets there (finalized — option A1, download at consent):** the npm package stays JS-only. On "yes" to auto-sync, cookd detects the user's os/arch, downloads the *one* matching binary your release job already publishes to the file host (GitHub Releases now; a swappable URL — your own host/CDN later), checksum-verifies it, and stores it at `~/.cookd/bin/cookd`. The user never sees a download prompt or GitHub — it's invisible plumbing behind a "setting up auto-sync…" spinner. Rejected alternatives: bundling all 5 binaries in the npm tarball (bloats every `npx` signup); per-platform `optionalDependencies` sub-packages (correct at scale, disproportionate publish machinery for beta — the A3 upgrade path); a local JS install (native-module fragility at hook time). See ADR-011 §Decision.

**The user-facing command does not change.** They still run `npx @codeclowns/cookd`. Only on "yes" to auto-sync does cookd download the binary and point the hook at it.

---

## 6. The consent flow (all in the terminal)

Consent must be in the terminal because **only the laptop can edit the laptop's file.** The app cannot perform (or meaningfully gate) a filesystem write on a different machine. The app's role here is display-only.

### If the user says YES — show the exact edit and why it's safe
```
  cookd will add this to  ~/.claude/settings.json  :

      "hooks": {
        "SessionEnd": [
          { "hooks": [
              { "type": "command", "command": "<abs>/.cookd/bin/cookd sync", "async": true, "timeout": 30 }
          ]}
        ]
      }

  what this does:  runs `cookd sync` when a Claude session ends.
  what it reads:   only that session's usage numbers.
  what it never:   touches your prompts, code, or files.
  runs in background — never slows Claude down.
  we back up your settings first and only add — never overwrite.
  remove anytime:  cookd uninstall

  add this line? [Y/n]
```

### If the user says NO — show how to see correct stats
```
  no problem — auto-sync stays off.
  your stats update whenever you run cookd. to refresh anytime:

      npx @codeclowns/cookd

  (already linked — this just re-syncs, no new code needed.)
```

### Non-interactive default
If the command runs with no TTY (CI, piped), it must **not** silently install. Default to off; require an explicit flag for scripted installs.

### UI style constraint
The consent prompt and the "exact edits" block **must follow the existing Ink UI system** — the same palette (`STAMP`/`MUT`/`FAINT`/`FLAME` from `ui/theme.ts`), box-drawing components (`Box`, `BoxDivider`, `BoxBottom`), and editorial/receipt treatment (`EditorialBlock`, `PressCode`-style framing) used by `init`. No new plain-text style; it should feel like part of the existing field-reporter flow. Plain-TTY fallback (`runInitPlain`) still needs a text-only equivalent.

---

## 7. Risks and mitigations

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| R1 | **Corrupting `settings.json`** (bad merge / partial write / overwriting the user's own hooks) | High | Parse first; if their file doesn't parse, stop and ask. Back up. Merge, never overwrite. Atomic write (temp + rename). |
| R2 | **Blast radius** — automation runs cookd silently on every session, so a *future* compromised release would auto-execute more often | Medium (honest, permanent tradeoff) | Pinned local binary (never `npx`/auto-latest). One-line uninstall. Open source / auditable. State it plainly to users. |
| R3 | **Coupling to Claude Code's hook contract** — event names, payload shape, reason values can change between versions | Medium | Isolate hook specifics behind the adapter. Verify payload shape per Claude Code version in a small spike. |
| R4 | **Missed events** — Claude force-killed/crashed → `SessionEnd` never fires → that session's final delta missed | Low–Medium | Add a `SessionStart` catch-up later (re-scan on next launch). The full-scan model (§8) already self-heals: the next sync picks up everything. |
| R5 | **Managed/enterprise blocks hooks** (`allowManagedHooksOnly`, `disableAllHooks`) | Low | Detect; tell the user auto-sync is unavailable and fall back to manual. |
| R6 | **Silent failures** — hook errors are non-blocking and invisible | Low | Keep the existing durable queue (`sync_queue`) for retry on failed pushes. |
| R7 | **Concurrency** — multiple projects ending sessions at once → parallel `cookd sync` processes | Low | SQLite WAL + the queue already tolerate concurrent writes. |
| R8 | **Cold start** per fire | Low | Compiled binary makes startup negligible (this is another reason not to use `npx`). |

**Is it harmful to the user?** No new capability is granted — cookd already ran with the user's privileges at signup; the hook just re-runs the same trusted binary automatically. The only concrete harm vector is R1 (mangling the config file), which is an engineering-discipline problem, fully preventable. R2 is the one honest, permanent tradeoff of automation, mitigated but not eliminated.

---

## 8. Why no data points are lost, and no backend/app change is needed

- A hook fire reads **the same kind of file, the same way** the code already reads today. The current `events()` already loops file-by-file; the hook just hands it one file at a time. **No field is lost at the reading level.**
- For this work, `cookd sync` **reuses the existing full-tree scan** and emits the **existing payloads** (`WindowSummary`, lifetime). The backend receives identical requests to the identical endpoints (`usage-ingest`, `wrapped-sync`).
- The `watch` loop *already* sends repeated `WindowSummary` snapshots on a heartbeat, so the backend already handles frequent repeated snapshots. The hook triggers the same thing. → **No backend change.**
- The app only displays what the backend has, in the same shape. → **No app/UI change.**

**Lifetime tokens:** because `cookd sync` runs the full scan, `computeLifetimeStats` still computes lifetime from the user's full history — you keep *everything*, including pre-signup work. (A future backend-accumulation model could switch to "from signup forward," but it is not needed now.)

**The deliberate tradeoff:** running the *full* scan on each session-end does slightly more work than reading just the one session file. That is the price of "change nothing else, lose nothing." It only fires on real activity, so it is bounded. If it ever becomes a scale cost, the *later* optimization is per-session incremental — and that one *would* need backend accumulation.

---

## 9. Alternatives considered — and why not (for now)

The phone can't reach the laptop, so a push must be triggered by one of exactly four things: **(a) Claude's lifecycle, (b) the OS, (c) cookd's own always-on process, (d) the user.** This taxonomy is exhaustive — every option is one of these.

### Family 1 — Borrow Claude's lifecycle (a)
| Option | Verdict |
|---|---|
| **Hooks — CHOSEN** | Zero idle cost, tightest privacy story, least code. Coupled to Claude Code. |
| **MCP server** | Same "Claude keeps it alive" benefit, but a semantic misuse (MCP is for exposing tools *to* Claude) and more complex for the same result. Hooks win. |
| **Statusline piggyback** | Hacky; a display hook fires very often and could be throttled. Rejected. |

### Family 2 — Run your own presence (c)
| Option | Verdict |
|---|---|
| **Background daemon** (launchd/systemd/Windows Service) | Reliable, tool-agnostic, but pays CPU 24/7, weakest privacy sentence, real cross-platform install work. Overkill for one agent. |
| **Tray / menu-bar app** | Industry standard for usage trackers; durable presence + its own UX. But a whole second app, always-on, heavier privacy footprint. Deferred. |
| **Scheduled task / cron** (b) | Lighter than a daemon but still pays on idle and lags. A fallback, not a primary. |
| **Shell hook** (`precmd`) | Noisy, fires constantly, privacy-adjacent, terminal-only. Rejected. |

### Family 3 — Don't collect on the laptop
| Option | Verdict |
|---|---|
| **Read usage server-side from Anthropic** | Ideal if possible, but Anthropic doesn't expose *Claude Code subscription* usage as a per-user feed; the data source *is* the local JSONL. Not viable today. Re-check if an API appears. |

### Manual re-run (d)
That is the status quo — the bug. Rejected as the primary path (kept as the fallback for users who decline auto-sync).

**Why hooks win now:** cheapest on DB (writes scale with real activity, idle users cost nothing), best privacy sentence ("only runs while you run Claude, then exits"), least code, and it reuses your existing binary and payloads.

---

## 10. Multi-agent plan (Codex, Cursor, …) — deferred, not blocked

**Decision: Claude Code only for now. Other adapters later.**

Hooks do **not** paint us into a corner, because cookd does two separable jobs per agent:

1. **Read** the agent's data — the **adapter** pattern (already have `claude-code`; a `cursor` stub exists).
2. **Trigger** a sync — the swappable part. Hooks are *Claude Code's* trigger, not cookd's only trigger.

`cookd sync` is **agent-neutral** and already scans across registered adapters. Adding an agent later = **add a reader adapter + wire up that agent's trigger.** Never a rewrite.

### Per-agent reality (verify specifics before committing a roadmap)
| Agent | Reader (data source) | Trigger |
|---|---|---|
| **Claude Code** | JSONL in `~/.claude/projects/` ✅ | Hooks ✅ (best) |
| **Codex CLI** | Session logs in `~/.codex/` (likely JSONL) | Likely a `notify`-style external-program trigger — **VERIFY** |
| **Cursor** | VS Code fork; SQLite/workspace storage | Likely **no** shell-hook system → watch files or build an extension — **VERIFY** |

**Universal fallback:** for any agent with no trigger, the "own presence" watcher/daemon covers it (and would fold Claude Code in too). So we're never stuck.

**Strategic note:** if cookd's ambition becomes "usage tracker for *all* coding agents," the tray-app/daemon path eventually becomes attractive because it watches every agent uniformly. That is a *product* decision to revisit when a second agent is actually on the near-term roadmap. Until then, do not build for agents we don't have.

---

## 11. Privacy

- The mechanical **counts-not-names** rule stands: no prompt text, tool arguments, code, or file contents leave the machine — only structural numbers, timestamps, booleans, durations, token counts, and fixed-vocabulary enums.
- Hooks do **not** worsen privacy; they arguably improve it (a hook can read only the one session Claude points at, versus scanning the whole tree).
- **Known follow-up (independent of this work):** `topProject` currently sends the raw project **folder name** — a content-derived string, which violates counts-not-names. Fix separately (hash/opaque id or a count). Tracked; not part of the hook change.

---

## 12. Scope

**In scope (companion-side only):**
- `cookd sync` headless subcommand (reuses full scan + existing payloads).
- Consented `SessionEnd` hook install into `~/.claude/settings.json` (backup, merge, atomic).
- Local binary install at `~/.cookd/bin/cookd`; hook references it by absolute path.
- `cookd uninstall`.
- Re-init guard fix: re-run of a linked device syncs silently, no press code.
- Non-interactive safe default (no silent install).

**Out of scope (now):**
- Any backend change.
- Any app/UI change.
- Per-session incremental sync + backend accumulation.
- `Stop`/per-turn "near-live" updates (kept as a future option).
- Codex/Cursor adapters and triggers.
- The `topProject` leak fix (tracked separately).

---

## 13. Open items / follow-ups
1. Spike: confirm a freshly-installed hook fires on the next session on Windows/macOS/Linux, and confirm the stdin payload shape on the target Claude Code version.
2. Spike (roadmap-gated): verify Codex `notify` trigger and Cursor data-store/trigger options.
3. Fix the `topProject` folder-name privacy leak.
4. Decide later whether to add a `SessionStart` catch-up for missed `SessionEnd` events.

---

## 14. Standing rules to preserve
- **Consent + transparency are ours to enforce** — Claude Code won't gate the hook.
- **Never overwrite the user's `settings.json`** — back up, merge, atomic write, reversible.
- **Hook calls a pinned local binary, never `npx`.**
- **`cookd sync` stays agent-neutral** so future adapters are additive.
- **Beta discipline:** changes must be additive and must not break existing linked users.
