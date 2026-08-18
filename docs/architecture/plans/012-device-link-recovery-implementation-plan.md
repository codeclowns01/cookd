# Device-Link Recovery Implementation Plan (ADR-012)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A linked laptop always mints a working press code, and never asserts a link state it has not verified. This closes a live account-recovery outage: cookd's only credential is the press code, and ADR-011's re-init guard withheld it from every already-linked device.

**Architecture:** Companion-first. No new endpoint — `device-link-start` grows one `link` object under two invariants (pure read, non-fatal). `runSyncOnce` stops collapsing four outcomes into one boolean. Both `init` flows consume a single shared relink decision function.

**Tech Stack:** TypeScript/Node ESM, commander, Ink (React), better-sqlite3 (WAL) queue, Vitest. Backend: Supabase Deno edge functions + Postgres migrations (`cookd-app`).

**Source of truth:** ADR-012 (`docs/architecture/decisions/012-device-link-recovery.md`) and cookd-app ADR-0010. See also `docs/architecture/CODEBASE-ARCHITECTURE.md` @ `bd3a590`.

**Starting state:** branch `fix/already-linked-press-code` holds an uncommitted partial Increment A — the withholding branch is already removed from both flows and `shouldSkipPressCode` is renamed `isAlreadyLinked` (158/158 vitest green). **That working tree is NOT shippable as-is** — see the Regression Register below. Tasks 1–5 make it shippable.

---

## Eng-review revisions (2026-08-18) — these SUPERSEDE conflicting inline task code below

### E1 — RESOLVES the sequencing fork: `init` forces a push (supersedes Task 5 Steps 1-2)

**Finding.** Option A-local as originally written was unshippable. With the ADR-011 hooks installed —
now the default population — `runSyncOnce` returns at gate 1 (`run.ts:41`) **before any HTTP**, so the
token is never positively confirmed alive. Task 5's fail-safe default would therefore fire the
"your account may not be recoverable" warning on nearly every healthy `init`, training users to
dismiss the one warning that matters. The heuristic was structurally incapable of the job.

**Resolution (option 1C).** `runSyncOnce` accepts `opts.force`, which skips gate 1 and gate 2.
**`init` — and only `init` — passes `force: true`.** Hooks keep both gates, so ADR-011's TG1
invariant ("an idle machine costs exactly zero") is preserved: the bypass is human-initiated and
at init frequency, never at `Stop` frequency.

```ts
// src/sync/run.ts
export async function runSyncOnce(
  creds: Credentials,
  opts: { force?: boolean } = {},
): Promise<SyncResult> {
  // Gate 1 — stat only. init passes force:true so the token is proven
  // alive (or rejected) on every recovery attempt; hooks keep the gate.
  if (!opts.force && state.lastPushedAt && signaturesEqual(signature, state.signature)) {
    return { outcome: 'unchanged', creds };
  }
```

**Consequences that supersede the plan text below:**
- Task 5 Step 2 no longer derives "confirmed alive" from a possibly-absent signal. After a forced
  push, `outcome` is authoritative for this run: `ok` → alive; `token_rejected` → dead;
  `network` → unknown (warn, since we cannot prove it alive).
- The `requiresConfirm` default stays fail-safe, but now fires **only** on genuine
  `token_rejected`/`network`, not on every healthy run.
- Task 11 (`link.state`) remains the correct long-term answer and still supersedes this, but is no
  longer a precondition for shipping A. **Increment A stays companion-only and ships today.**
- Add a test: `init` calls `runSyncOnce` with `force: true`; `sync`/`watch` do not.

---

## Design-review revisions (2026-08-18) — Task 1 banner + Task 5 confirmation

Scope agreed with founder: focus on (X) copy for the six CLI states and (Y) the revoked-token
confirmation. Plan rated **4/10** on design completeness at review start — states named, copy unwritten.

### DD1 — Reuse `ConfirmSheet`, do not build a Lock dialog (Task 10)

`app/src/components/ConfirmSheet.tsx` exists and `RapSheet.tsx:307` **already uses it for exactly
this interaction** — a sign-out confirmation. Lock's confirmation reuses it with different copy.
Building a second dialog would fork the pattern for no gain.

### DD2 — Copy is a pure, tested function, mirroring `consentLines()`

`ui/ink/Consent.tsx` establishes the pattern: a pure `string[]` builder plus a separate
`consentColorFor()`. **Both new surfaces follow it** — `relinkLines()` and `revokedLines()` in
`ui/ink/`, tested in `test/hooks/consent-copy.test.ts`'s sibling. This is what makes Ink/plain
parity structural rather than a discipline problem: **one copy source, two renderers** (and it is
what Task 1 already requires for the banner).

Voice constraints from the existing system: lowercase, no exclamation, no emoji, the
`what it does / what it reads / what it never` triplet where consequences are being disclosed.
**Colour may never be the only signal** — the plain flow is monochrome, so every meaning must survive
as words.

### DD3 — The six states, drafted

```
1. FRESH DEVICE (no credentials)          → unchanged from today; full press-code ceremony.

2. HEALTHY RELINK (force-push returned ok)
   ✓ linked as @kanwar — synced.
   ─────────────────────────────────────────
   need to sign the app in again? code: 7K2M9Q
   (expires 18:04 — ignore this if everything's fine)

3. TOKEN DEAD (token_rejected)            → see DD4. Confirmation BEFORE any code is printed.

4. NETWORK UNKNOWN (network)
   couldn't reach the press — can't confirm this laptop's pass.
   ─────────────────────────────────────────
   a code is below, but if your pass was cancelled,
   using it starts a NEW account. reconnect first if you can.
   code: 7K2M9Q

5. NO ADAPTER / NO EVENTS
   no claude code history here — nothing to sync.
   you can still link this machine:  code: 7K2M9Q

6. NON-TTY  → prints state + code, exits immediately. Never blocks, never auto-confirms.
```

State 4 is the one the original plan had no answer for. It must neither claim health nor claim
failure — **"can't confirm"** is the honest third thing, and the guidance still points at recovery.

### DD4 — The revoked-token confirmation (the highest-stakes screen in the product)

```
  YOUR PRESS PASS ISN'T RECOGNISED.

  this laptop's credentials don't match any device
  on record. that usually means the device was
  removed from your rap sheet, or the machine was
  re-imaged.

  what happens if you continue:
    · you'll get a press code
    · redeeming it starts a NEW account
    · your handle, history, badges and streaks
      do NOT come with you
    · the old account can't be reached from here

  continue and start over?  [y/N]
```

Four design calls, each deliberate:

- **"isn't recognised", never "revoked."** `data.ts:807` hard-`DELETE`s the row, so a removed device
  and one that never existed are genuinely indistinguishable. Saying "revoked" claims knowledge we
  do not have — the same class of dishonesty as the `synced.` bug this ADR exists to kill.
- **Consequences as a list, not prose.** Four irreversible losses; prose hides the fourth.
- **Names what is lost in the user's own vocabulary** — handle, history, badges, streaks — not
  "account data."
- **No colour dependency.** Reads identically in the plain flow.

### DD5 — 🔴 The confirmation must default to NO — existing helper is wrong for this

`init.tsx` `askYesNoDefaultYes()` returns `true` on empty input (`!/^\s*n/i.test(answer)`). It was
written for the auto-sync offer, where the default-yes bias is correct and the action is reversible
(`cookd uninstall`). **Reusing it here would make "press Enter" destroy an account.** Task 5 needs
`askYesNoDefaultNo()`, and the prompt renders `[y/N]` to match. This is the single highest-severity
design finding in the review: a reversible-action helper silently reused on an irreversible action.

### DD6 — Banner must hedge the handle until Task 11

State 2 renders `@kanwar` from cache. `RapSheet.tsx:413` ships a live handle rename, so until
`link.handle` exists the banner reads **"last known as @kanwar"** or omits the handle. An unhedged
stale handle on an identity operation violates ADR-012's guardrail metric directly.

---

## ~~⚠️ OPEN SEQUENCING FORK~~ — RESOLVED by E1 above (retained for context)

ADR-012 decision 8 places decision 5 (`unrecognized` → explicit confirmation) in Increment A. But
`link.state` is produced by `device-link-start` (decision 2), which is a **backend deploy** carrying
the `config.toml` risk that ADR-0010 decision 6 says must be resolved first. So Increment A cannot be
simultaneously "companion-only, ships in minutes" *and* carry decision 5. One of these must give:

- **Option A-local** — A1 ships companion-only. Revoked-token detection is best-effort from
  `loadSyncState().lastError` (`gate.ts:35`) plus this run's `PushOutcome`. **Fails open**: a dead
  token on a laptop with no new usage returns at `run.ts:41`/`:63` before any HTTP, so we never learn
  it is dead and print no warning. Mitigate by inverting the default — warn whenever the token was
  **not positively confirmed alive this run**, which is conservative and slightly noisy.
- **Option A-full** — A includes the one-field `device-link-start` change. Correct detection, but
  testers wait on a backend deploy and the config reconciliation.

This plan is written for **A-local**, with Task 5 structured so the `link.state` upgrade in Task 11 is
a drop-in replacement for the local heuristic. Eng review should confirm or overturn.

---

## File Structure

```
src/commands/init-guard.ts      # + resolveRelink() — the one shared decision fn (Task 1)
src/commands/init.tsx           # both flows consume it (Tasks 1,3,4,5)
src/sync/run.ts                 # SyncOutcome discriminated union (Task 2)
src/sync/client.ts              # unchanged — already returns PushOutcome
src/auth/device-link.ts         # credential preservation + poll leash (Tasks 3,4)
src/commands/{sync,watch}.ts    # SyncOutcome call sites (Task 2)
test/commands/init-guard.test.ts
test/commands/init-relink.test.ts   # new
test/sync/run.test.ts
```

---

## Regression Register — what the current working tree breaks

Each must be closed before Increment A ships. Verified 2026-08-18.

| # | Defect | Evidence | Task |
|---|---|---|---|
| R1 | Revoked token + signed-out app → new account created, local token overwritten, **old account unrecoverable** | `device-link-start:70-74` → `device-link-confirm:126`; `init.tsx` `saveCredentials` | 5 |
| R2 | `pollForLink` wipes `lastWrappedSync` + `lastCookedEventSentAt`; `watch.ts:40` re-pushes lifetime history | `device-link.ts:74-79` vs `credentials.ts:6-14` | 3 |
| R3 | `init` blocks 10 min on a healthy laptop; non-TTY hangs; Ctrl-C skips `offerAutoSync` (reintroduces B2) | `device-link.ts:60`, awaited at `init.tsx` both flows | 4 |
| R4 | Prints `synced.` after zero network calls; new copy then advises the broken cohort to ignore the code | `run.ts:41`; `init.tsx` plain path | 2, 5 |
| R5 | Ink path reports the resync result not at all; plain path lies about it; banner copy + handle casing diverge | `init.tsx` both flows | 1 |

---

## Task 1: One shared relink decision function

**Closes R5.** The dual-flow drift has now recurred three times, the third inside the very diff that documents the first as a lesson.

- [ ] **Step 1 (test first).** In `test/commands/init-guard.test.ts`, add cases for `resolveRelink({ alreadyLinked, syncOutcome, tokenConfirmedAlive })` returning `{ bannerLines, shouldPrintCode, requiresConfirm, resyncLine }`. Cover: fresh device, healthy relink, unconfirmed token, `no_adapter`.
- [ ] **Step 2.** Implement `resolveRelink` in `src/commands/init-guard.ts` as a **pure function** — no I/O, no chalk, no Ink. It returns plain strings; renderers apply theme.
- [ ] **Step 3.** Ink flow consumes it; delete the inline banner literals.
- [ ] **Step 4.** Plain flow consumes it; delete its inline banner literals.
- [ ] **Step 5.** Add a test asserting **both** flows derive from `resolveRelink` — grep-style assertion that neither file contains a hardcoded relink banner string.

**Verify:** `npx vitest run` green; banner text exists in exactly one source file.

## Task 2: `runSyncOnce` returns a discriminated outcome

**Closes R4 (half).** The real signal already exists and is discarded at the boundary.

- [ ] **Step 1 (test first).** `test/sync/run.test.ts` — assert each of the five paths returns its own outcome: `no_adapter` (`run.ts:32`), `unchanged` (`:41`), `gated` (`:63`), `ok`, and the `PushOutcome` passthrough (`token_rejected` | `network`).
- [ ] **Step 2.** Change `SyncResult` to `{ outcome: SyncOutcome; creds: Credentials }`. **Do not** keep a `synced` boolean alongside it — a redundant field will drift.
- [ ] **Step 3.** Update all call sites: `init.tsx` (both flows), `commands/sync.ts`, `commands/watch.ts`.
- [ ] **Step 4.** `init` prints from the outcome: `ok` → "synced.", `unchanged`/`gated` → "nothing new to send.", `token_rejected` → "your press pass was refused.", `network` → "couldn't reach the press.", `no_adapter` → no claim at all.

**Verify:** no call site prints success without inspecting `outcome`; grep for `'synced.'` returns one site.

## Task 3: `pollForLink` preserves existing credentials

**Closes R2.** Dormant only because the guard kept linked devices away from this function.

- [ ] **Step 1 (test first).** Assert that when `pollForLink` is given existing credentials carrying `lastWrappedSync` and `lastCookedEventSentAt`, the returned object retains both.
- [ ] **Step 2.** Change the signature to accept the full existing `Credentials | null` rather than just `existingDeviceToken`, and return `{ ...existing, deviceToken: token, handle: status.handle, deviceId, linkedAt: ... }`.
- [ ] **Step 3.** In both `init` flows, capture `runSyncOnce`'s returned `creds` and thread it into `pollForLink` — `runSyncOnce` may have just written `lastCookedEventSentAt` to disk (`run.ts:115-117`).
- [ ] **Step 4.** Regression test: a relink does not reset `lastWrappedSync` (which would trigger the `watch.ts:40` full-history re-push).

**Verify:** `watch.ts:40` cannot fire after a recovery relink.

## Task 4: Short poll leash

**Closes R3.**

- [ ] **Step 1 (test first).** Assert the relink path polls with a bounded timeout (≤120s) while a **fresh** link keeps the existing 10-minute window — a first-time user genuinely needs time to install the app.
- [ ] **Step 2.** Thread an explicit `timeoutMs` from the call site rather than relying on the default.
- [ ] **Step 3.** Run `offerAutoSync` **before** `pollForLink` on the relink path, so a Ctrl-C costs nothing (B2 protection independent of the timeout).
- [ ] **Step 4.** Non-TTY: `runInitPlain` on a linked device must print the code and **exit without awaiting redemption**. A piped/CI `init` must never block.

**Verify:** `COOKD_API_URL` pointed at a stub, non-TTY `init` on a linked device exits promptly.

## Task 5: Revoked-token confirmation (A-local heuristic)

**Closes R1** — the blocking defect. Structured so Task 11 swaps the heuristic for `link.state`.

- [ ] **Step 1 (test first).** `resolveRelink` returns `requiresConfirm: true` whenever the token was **not positively confirmed alive this run** (fail-safe default), and `false` only on a confirmed-alive signal.
- [ ] **Step 2.** Derive "confirmed alive" from this run's `outcome === 'ok'`; derive "known dead" from `outcome === 'token_rejected'` or persisted `loadSyncState().lastError === 'token_rejected'`.
- [ ] **Step 3.** Confirmation copy states that continuing **abandons the previous handle, history and badges**. Wording must be *"no longer recognised"*, not *"revoked"* — `data.ts:807` hard-deletes the row, so revoked and never-existed are genuinely indistinguishable.
- [ ] **Step 4.** Declining exits **without minting a code**. Both flows. Non-TTY never auto-confirms — it prints the warning and exits.
- [ ] **Step 5.** A1 banner must **hedge the handle**: "last known as @X" or omit it. `RapSheet.tsx:413` ships a live rename, so the cached handle can be stale, and ADR-012's guardrail metric is "codes redeemed into the wrong account = 0".

**Verify:** the R1 scenario (dead token + signed-out app) cannot reach `pollForLink` without an explicit confirmation.

## Task 6: Suppress the auto-sync re-prompt when hooks exist

- [ ] **Step 1 (test first).** `shouldOfferAutoSync(outcome, hooksInstalled)` returns `false` when `hooksInstalled`.
- [ ] **Step 2.** Call `hasCookdHook(claudeSettingsPath())` wrapped in try/catch — `SettingsError` on an unparseable file must fall through to *offering*, not crash `init`.
- [ ] **Step 3.** Apply in both flows.

## Task 7: `cookd logout`

**Mandatory, not optional** — ADR-012 rejected `--new-account`, making this the only way to release a machine.

- [ ] **Step 1 (test first).** Removes `~/.cookd/credentials.json`; leaves hooks and binary intact; is idempotent when already absent.
- [ ] **Step 2.** Implement `src/commands/logout.ts`; register in `cli.ts`.
- [ ] **Step 3.** Output must state that the account itself is untouched and that a new `init` will start a **new** account unless the app is used to link back.

## Task 8: Docs

- [ ] `README.md:64` — drop "(an already-linked machine syncs silently, no new press code)"; it now asserts superseded behaviour. Use `npx @codeclowns/cookd init`.
- [ ] `CHANGELOG.md` entry naming the recovery fix.

---

# Increment A2 (cookd-app, store cadence — does NOT gate A1)

## Task 9: Recovery copy

- [ ] `Recovery.tsx:30` → `const COMMAND = 'npx @codeclowns/cookd init'`.
- [ ] Rewrite the `token_rejected` branch prose (`:59-66`) — "run it again / it will issue a fresh press code / the old one stays dead" now describes an action that silently discards the account. It must say the account may not be recoverable and that history will not follow.
- [ ] Existing `Recovery` tests updated; add one asserting every `COPY` entry's command string contains `init`.

## Task 10: Lockout doors

- [ ] Lock-screen `signOut()` behind a confirmation naming the consequence (no password; getting back in needs a new press code from the laptop).
- [ ] Register `LinkCompanion` in the `locked` navigator branch.
- [ ] Update `navigation-gate.test.tsx` / `lock.test.tsx`.

---

# Increment B (backend — gated on config reconciliation)

## Task 11: `device-link-start` returns `link: { state, handle }`

- [ ] **Step 0 — BLOCKING PRECONDITION.** Reconcile `supabase/config.toml` against the deployed project. It lists 2 of 10 functions; `device-link-*` demonstrably runs with `verify_jwt` off. **Redeploying could re-enable verification and break linking product-wide.** Do not proceed until verified in the dashboard.
- [ ] **Step 1 (test first).** New `device-link-start/pure.ts` + `pure.test.ts`: `classifyBearer` → `authenticated | unrecognized | anonymous`.
- [ ] **Step 2.** Register `pure.test.ts` in **both** `.github/workflows/test.yml:71-75` and `package.json:8` — hardcoded lists; `public-rapsheet/pure.test.ts` is already silently not running.
- [ ] **Step 3.** Add the join on `users.github_login`; return `link`. **Pure read — no write to `devices`.**
- [ ] **Step 4.** Companion consumes `link.state`, replacing Task 5's heuristic; unhedge the handle. Absent `link` → today's behaviour (non-fatal).

## Task 12: Backend hardening

- [ ] `device-link-confirm`: compare `session.user_id` against an authenticated caller's JWT; refuse or flag on mismatch. `LinkCompanion.tsx` must inspect the response before rendering success.
- [ ] Migration `0026`: `unique (press_code) where status = 'pending'` + retry-on-conflict in `device-link-start`.
- [ ] `device_link_sessions` reaper — row growth is now one per `init` run, and rows hold plaintext `device_token`.

---

## NOT in scope (considered, deferred)

Attempt-limiting on `device-link-confirm` (**its original justification no longer holds** — see ADR-012 System Consequences); `DEMO00` hardcoded APK credentials; `--new-account`; multi-device management UI; corrupt-`credentials.json` duplicate-device rows; `demo-usage-sim` drift; ADR-011's `resets_at`/`window_start` NULL contract mismatch (defect B1, separate).

## Failure modes per new codepath

| Path | Failure | Behaviour |
|---|---|---|
| `resolveRelink` | — | pure, total; no I/O to fail |
| `runSyncOnce` outcome | network down | `network`; code still printed |
| poll leash | user slow to redeem | code expires; `offerAutoSync` already ran |
| revoked confirm | non-TTY | warns, exits, never auto-confirms |
| `link` fetch (B) | absent/failed | degrades to A behaviour — **never withholds the code** |

## Acceptance-criteria mapping

ADR-012 AC1→T1, AC2→T1, AC3→T2, AC4→T3, AC5→T4, AC6→T5/T11, AC7→T11, AC8→T11, AC9→T5, AC10→T9, AC11→T8, AC12→T12, AC13→T11.

---

## What already exists (reused, not rebuilt)

| Need | Already exists | Reused? |
|---|---|---|
| Recovery handshake for a linked device | `device-link-start` bearer pre-auth → `device-link-confirm:97` → `Entrance.tsx:51` `setSession()` | **Yes** — built and unreachable; the guard was the only blocker |
| Real push failure classification | `client.ts:94` `PushOutcome` (`ok\|token_rejected\|network`) | **Yes** — Task 2 stops discarding it |
| Persisted last error | `run.ts:126` → `gate.ts:35` `sync-state.json` | Yes — corroborating signal |
| Hook-installed check | `hooks/settings.ts` `hasCookdHook()` | **Yes** — Task 6; existed, only `health.ts` consulted it |
| Consent copy pattern | `ui/ink/Consent.tsx` pure `string[]` + colour fn | **Yes** — DD2 mirrors it |
| Confirmation dialog (app) | `components/ConfirmSheet.tsx`, used at `RapSheet.tsx:307` | **Yes** — DD1; no new dialog |
| Handle authority | `users.github_login`, read by `device-link-confirm:118` | Yes — Task 11 |
| Cooked-event idempotency | `0016_cooked_events_unique.sql` | Yes — backstops R2's replay |

## Worktree parallelization

| Step | Modules touched | Depends on |
|---|---|---|
| T1 Shared decision fn | `src/commands/` | — |
| T2 `SyncOutcome` + E1 force | `src/sync/`, `src/commands/` | — |
| T3 Credential preservation | `src/auth/`, `src/commands/` | — |
| T4 Poll leash | `src/auth/`, `src/commands/` | T3 |
| T5 Revoked confirm | `src/commands/`, `src/ui/ink/` | T1, T2 |
| T6 Hook re-prompt | `src/commands/`, `src/hooks/` | T1 |
| T7 `cookd logout` | `src/commands/`, `src/auth/` | — |
| T9/T10 App copy + doors | `cookd-app/app/src/` | — |
| T11/T12 Backend | `cookd-app/supabase/` | T2 |

- **Lane A** (companion): T2 → T1 → T3 → T4 → T5 → T6. Effectively sequential — all six touch
  `src/commands/init.tsx`. Attempting to parallelize these *is* the drift mechanism that caused R5.
- **Lane B** (`cookd-app` app): T9 → T10. Independent repo, fully parallel with A.
- **Lane C** (`cookd-app` backend): T11 → T12. Gated on T11 Step 0 (config reconciliation) and on
  T2's outcome shape.

**Execution:** launch A and B in parallel worktrees; C waits on both its own precondition and T2.
**Conflict flag:** T7 (`logout`) also touches `src/commands/` and `src/auth/` — it is genuinely
independent of the init flow and *could* be a fourth lane, but it edits `cli.ts`, which Lane A does
not. Safe to parallelize; merge `cli.ts` carefully.
