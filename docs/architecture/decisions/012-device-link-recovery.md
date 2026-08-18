# ADR-012: A linked laptop always mints a press code, and never asserts a link state it has not verified

- **Status**: Accepted
- **Date**: 2026-08-18
- **Source manifest**: `docs/architecture/manifests/device-link-recovery-scope-manifest.md`
- **Deciders**: Chief Architect (automated pre-development review)
- **Supersedes**: ADR-011 — **decision #4 and acceptance criterion #5 only**. Everything else in ADR-011 stands.

> **Superseding preamble.** Trigger: Play Store closed-track testing, 2026-08-17/18. Two independent
> founder reports of being locked out of the app *while the backend link stayed healthy and syncing*.
> ADR-011 decided (#4) that a device holding valid `credentials.json` should "skip the press-code
> handshake and sync silently", and locked AC5 to match. That was correct about the problem it solved
> — a returning user refreshing stats should not be re-asked to link — and wrong about a consequence
> it did not consider: **the press code is not merely a linking mechanism, it is cookd's only
> credential.** Withholding it withholds the sole means of account recovery. ADR-011's open question
> **R3 ("re-init guard credential branch")** named this surface as risky; the lockout consequence was
> not caught. Carried forward unchanged: the `cookd sync` subcommand, the SessionStart/SessionEnd/Stop
> hooks, binary provisioning + checksum, `cookd uninstall`, and the Ink-plus-plain-TTY UI rule.

## Context

cookd has no email and no password by design (`Entrance.tsx`: "no email. no password. no tourists.").
A 6-character press code is the only credential that exists. The app holds a Supabase session; the
laptop holds `~/.cookd/credentials.json`. **Nothing reconciles the two**, and the CLI decides its
entire behaviour by reading a local file it wrote at link time.

Core Wedge, from the manifest: *a linked laptop can always mint a working press code, and never lies
about the link's state.*

## Discovered Code Friction

- `src/commands/init-guard.ts` + `src/commands/init.tsx` — the ADR-011 guard early-returns before
  `deviceLinkStart`, making the press code unobtainable for any device holding a token.
- **The recovery primitive already exists and was unreachable.**
  `supabase/functions/device-link-start/index.ts:64-69` hashes the `cookd_` bearer, reads
  `devices.token_hash → user_id`, and pre-populates `device_link_sessions.user_id` (`:80`).
  `device-link-confirm/index.ts:97` evaluates `session.user_id` **before** the app's JWT branch
  (`:118`), mints fresh Supabase tokens for that account, and `Entrance.tsx:51` calls `setSession()`.
  **The app adopts the laptop's account.** Nothing new is needed for core recovery.
- `Recovery.tsx:30` — `const COMMAND = 'npx @codeclowns/cookd'`, no `init` subcommand. Verified by
  execution: prints help, exits 0, recovers nothing. All five reason branches use it.
  `README.md:64` repeats it *and* asserts the now-superseded ADR-011 behaviour.
- **Device revocation is a shipped, reachable, two-tap path.** `RapSheet.tsx:284` ("my devices") →
  `data.ts:807` `supa.from('devices').delete().eq('id', id)` — a hard `DELETE`, not a flag. So
  `maybeSingle()` in `device-link-start` genuinely finds nothing, and **a revoked device is
  indistinguishable from one that never existed.**
- **A revoked bearer does not 401.** `device-link-start:70-74` leaves `preAuthedUserId` null; a
  signed-out app sends the anon key so `isAuthenticatedUserJwt` (`device-link-confirm:118`) is false;
  control reaches `:126` and calls `admin.auth.admin.createUser`. A **new account is created silently**.
- `src/auth/device-link.ts:74-79` — `pollForLink` constructs a **fresh 4-field** `Credentials`, but
  the interface (`credentials.ts:6-14`) has six. `lastWrappedSync` and `lastCookedEventSentAt` are
  dropped; `init.tsx` then `saveCredentials()` overwrites. `watch.ts:40` keys off `!lastWrappedSync`
  → full lifetime re-push through the direct-POST bypass (`client.ts:56`). **Dormant until the guard
  is removed; removing it is what wakes it.**
- `src/auth/device-link.ts:60` — `timeoutMs = 10 * 60 * 1000`, awaited unconditionally by both flows.
- `src/sync/run.ts` — `runSyncOnce` returns `{synced:false}` **without throwing** for four distinct
  causes (`:32` no adapter, `:41` unchanged signature, `:63` growth gate, `:133` push rejected).
  `src/sync/client.ts:94` already computes the real `PushOutcome` and `run.ts:126` already persists it
  to `~/.cookd/sync-state.json` (`gate.ts:35`). The signal exists and is discarded at the boundary.
- **Reuse hazard.** `devices.last_seen` has two writers (`usage-ingest/index.ts:270`,
  `wrapped-sync/index.ts:79`) meaning "this token was used", and
  `0024_limit_states_view.sql:296` orders by it (`order by dv.last_seen desc nulls last`) to pick
  **which device represents the user** for freshness diagnostics. Both `usage-ingest:155` and
  `0024:67` carry explicit comments warning off the column.
- `supabase/config.toml` sets `verify_jwt = false` for **only** `usage-ingest` and `public-rapsheet`,
  yet `device-link.ts:21` sends no apikey and a non-JWT `cookd_` bearer, and linking demonstrably
  works — so `device-link-*` was deployed out-of-band. **The repo config contradicts the deployed
  state for three of ten functions.**
- `0020_device_link_sessions.sql:25` — the `press_code` index is **not unique**;
  `device-link-confirm:73-75` resolves collisions with `order by created_at desc limit 1`.
- `.github/workflows/test.yml:71-75` and `package.json:8` hardcode three `pure.test.ts` paths;
  `public-rapsheet/pure.test.ts` exists and **never runs**.
- `RapSheet.tsx:413` — `update({ github_login: h })`; the handle rename is live and shipped, so a
  cached handle can be stale.

## Adversarial Review Debate

**Architect (1).** The manifest asks for a device-status probe. I want to *not build one*.
`device-link-start:64-69` already performs the exact lookup a probe would perform. Add one join on
`users.github_login` and return `link: { state, handle }` where state is
`authenticated | unrecognized | anonymous`. Zero added round trips, and if `link` is absent (older
deployment) the CLI degrades to printing the code. The manifest's non-fatal invariant is satisfied
**by construction** — there is no independent call to time out.

**Critic (1).** Agreed on not building it, for a different and more damning reason: your probe cannot
see the actual reported bug. `init.tsx`'s own comment concedes it — *"no probe can detect that case,
because nothing about it is broken from the server's side — the token is live, it is just pointed
elsewhere."* So the probe's entire load-bearing value reduces to distinguishing `token_rejected` from
healthy, which one boolean on an existing response already answers. A week of Increment B for that is
indefensible. But your real problem is Increment A, which you are calling a three-line change. It is
not. `RapSheet.tsx:284` → `data.ts:807` hard-`delete`s the device row. So: cofounder's device is
unlinked, app session also lost. He runs `init`. Your change prints a code. He redeems it.
`preAuthedUserId` is null, `device-link-confirm:126` creates `chefk4m2`, and `init.tsx` overwrites
`credentials.json` with the new token. **The old account now has zero devices and zero credentials
anywhere in the universe.** Before this change the guard blocked at the press code and the account
stayed recoverable. You have converted a recoverable lockout into irreversible account destruction,
and the manifest scoped the "warn loudly + confirm" mitigation into Increment B.

**Architect (2).** That lands, and it is fatal to the A/B split as written. But the fix needs no
endpoint: `init` already runs `runSyncOnce` *before* `deviceLinkStart` on both paths, and
`token_rejected` is already computed (`client.ts:94`) and already persisted (`run.ts:126`,
`gate.ts:35`). So the revoked-token confirmation and the honest `SyncResult` move **into Increment A**.
That is a deliberate manifest amendment and it costs about a day, not three lines. Without it I would
argue against shipping A at all.

**Critic (2).** Accepted, and it is still not enough. Three more, all activated by removing the guard.
One: `device-link.ts:74-79` rebuilds `Credentials` from four fields when the interface has six.
`lastWrappedSync` and `lastCookedEventSentAt` are wiped on every relink, and `watch.ts:40` then
re-pushes the entire lifetime history. That bug was unreachable *because* `shouldSkipPressCode`
guaranteed a linked device never reached `pollForLink`. You are removing the only thing keeping it
asleep. Two: `device-link.ts:60` is a ten-minute timeout, awaited unconditionally. A healthy user
running `init` to refresh now blocks for ten minutes; in non-TTY — CI, piped, or the EIO fallback —
it hangs with no countdown and no way to answer. The rational TTY response is Ctrl-C, which skips
`offerAutoSync` and **functionally reintroduces defect B2**, the very thing your diff congratulates
itself for preserving. Three: you are printing `synced.` after making zero network calls — with
ADR-011's hooks installed, which is now the default population, gate 1 at `run.ts:41` returns before
any HTTP. Your new copy then tells a broken user *"use the code below only if the app isn't showing
this machine"*. The old code was silent; yours is a confident false assertion aimed precisely at the
cohort that is broken.

**Architect (3).** All three conceded; all three go into A. Watermarks: `pollForLink` spreads existing
creds and `init` threads `runSyncOnce`'s returned `creds` forward. Poll: a short leash — 60-120s —
which also serves your rate-limit objection, or run `offerAutoSync` before `pollForLink`. Copy: consume
the boolean, and until `link.handle` exists in B, the banner must hedge to *"last known as @X"* — I
will not print an unhedged cached handle when `RapSheet.tsx:413` ships a live rename. On placement I
hold my ground: extend `device-link-start`, do not add a function. A second endpoint named
`device-status` beside the existing `device-link-status` — one keyed by `sessionId`, one by bearer,
with opposite auth postures — is an operations footgun, and `device-link-status` is the one that must
never break.

**Critic (3).** I concede placement; naming collision was my objection #9 and you have removed it.
Two conditions on the extension. First, **the probe must be a pure read** — if it bumps
`devices.last_seen` it outranks the laptop that is actually filing and poisons `Recovery.tsx`'s entire
diagnosis via `0024:296`. Make that an ADR invariant beside the non-fatal one. Second,
`config.toml` lists two of ten functions while `device-link-*` demonstrably runs with verification
off. Redeploying `device-link-start` from this repo could flip `verify_jwt` back on and **break
linking for everyone** — you are proposing to edit the one function on the critical path of every
new signup. Reconcile the config against the deployed project *before* B, and treat that as unproven
until someone checks the dashboard. Finally, my rate-limit deferral objection stands and A is what
falsifies it: the risk register justified deferring attempt-limiting on "32^6 with a 10-minute TTL",
but the attacker's search space is the *live pending set*, and A mints a code on every `init` that
then runs its full TTL unredeemed. A shorter TTL is one constant and cuts it 5-10x.

**Convergence.** No new endpoint; `device-link-start` grows a `link` object, pure-read, non-fatal by
construction. The Critic forced a materially larger Increment A than the manifest scoped: it absorbs
the revoked-token confirmation, the honest `SyncResult`, the credential-watermark fix, and a short
poll leash — without these, A is a net regression on the revoked path. The Critic conceded the core
diagnosis, that TTL/single-use are genuinely enforced in code, that the non-fatal invariant is the
right instinct, and that holding the line against "show the code only on fault" is the most important
call in the manifest. Cross-account token minting (`device-link-confirm:97`) is real but server-side
and does not block A.

## Decision

**1. Remove the withholding branch; the press code is unconditional.** A linked device re-syncs, then
mints a code. `isAlreadyLinked()` answers a question about credentials and never gates control flow.
This supersedes ADR-011 #4/AC5.

**2. Extend `device-link-start`, do not add an endpoint.** It returns
`link: { state: 'authenticated'|'unrecognized'|'anonymous', handle }`, read from `users.github_login`
in the same request that writes `device_link_sessions.user_id`. Two invariants:
**(a) pure read** — it must never write `devices.last_seen` or any other column;
**(b) non-fatal** — absent or failed `link` degrades to printing the code.
*Rejected:* a separate `device-status` function — collides with `device-link-status`, adds an
independently-failing call, and cannot answer the live-token-wrong-account case anyway.
*Rejected:* returning 0024's `freshness` vocabulary — that view picks a representative device by
`last_seen`, which on a multi-device account is not necessarily this laptop.

**3. `cookd sync` never calls it.** Sync already knows: `client.ts:94` sets `token_rejected` and
`run.ts:126` persists it. Calling a press-code minter at hook frequency would mint unviewed codes
continuously and widen the un-rate-limited guessing surface.

**4. `runSyncOnce` returns a discriminated outcome** — `no_adapter | unchanged | gated | ok |
token_rejected | network` — instead of a boolean meaning four things. No call site may print success
without inspecting it.

**5. `unrecognized` requires an explicit confirmation before any code is printed**, stating that
continuing abandons the previous handle, history and badges. Copy must say *"no longer recognised"*,
not *"revoked"* — `data.ts:807` hard-deletes, so the two are genuinely indistinguishable.

**6. `pollForLink` preserves existing credentials** (`{...existing, deviceToken, handle, deviceId,
linkedAt}`) and `init` threads `runSyncOnce`'s returned `creds` forward.

**7. Short poll leash on the relink path** (60-120s), or `offerAutoSync` runs before `pollForLink`.
Never a ten-minute unconditional block, and never a non-TTY hang.

**8. Increment A absorbs 4, 5, 6, 7.** *Rejected:* the manifest's original split, which shipped the
destructive path with none of its guard rails.

**9. One shared relink decision function** in `init-guard.ts` returning
`{ resyncOutcome, bannerLines, shouldPrintCode }`, consumed by both renderers.

## System Consequences

- **A healthy `init` gets slower and noisier**: one press code minted per run, plus a poll window.
  Bounded to ~60-120s by decision 7 instead of 600s. The `device_link_sessions` row count changes from
  *one per new device ever* to *one per `init` run* — no vacuum job exists (`0025` covers usage tables
  only), and rows hold plaintext `device_token` cleared only on a successful poll. **A reaper is now
  required**, and it is new operational burden this decision creates.
- **New failure mode:** `device-link-start` is on the critical path of every first-time signup. Any
  bug in the `link` extension breaks new-user linking, not just recovery. This is the isolation traded
  away for removing an independent failure mode; it is why the extension must be additive and why the
  `pure.ts` tests are mandatory.
- **Security posture changes, capability does not.** `device-link-start` now names an account to any
  caller holding the token file. The token already grants full account access (`usage-ingest:63-72`),
  so this is new *disclosure*, not new *authority*. Separately, printing a code per run raises the
  concurrent pending-code count, which is the variable the deferred attempt-limiting analysis assumed
  constant — the deferral is no longer justified on its original reasoning.
- **Recovery relink stops re-pushing lifetime history** (decision 6), removing a `last_seen` bump and
  a full direct-POST replay per recovery.
- **Two beliefs can briefly disagree**: `runSyncOnce` and `deviceLinkStart` are separated by a full
  transcript scan. Resolved by authority ordering — `link.state` wins, `PushOutcome` corroborates —
  not by reconciliation.

## Conventions & Patterns for Implementation

- **Follow** the Ink-plus-plain-TTY rule (`CODEBASE-ARCHITECTURE.md` Conventions; `init.tsx:408`
  fallback). Both flows must consume the **same** shared function from decision 9 — the drift this
  guards against has already recurred three times inside the current uncommitted diff.
- **Follow** the edge-function `pure.ts` + `pure.test.ts` convention (`usage-ingest`, `wrapped-sync`,
  `public-rapsheet`). `device-link-start` has none; add it. **Register new test files in both
  `.github/workflows/test.yml:71-75` and `package.json:8`** — hardcoded lists, and
  `public-rapsheet/pure.test.ts` is already silently not running.
- **Extend** `sync/client.ts`'s existing `PushOutcome`; do not invent a parallel error vocabulary.
- **Extend** `ui/ink/*` + `ui/theme.ts` for the confirmation screen; no new visual style.
- **Avoid** writing `devices.last_seen` from any new path (decision 2a).
- **Avoid** widening the direct-POST bypass (`client.ts:35,47`) — ADR-011's rule, still standing
  except for buckets per ADR-0009.
- **Avoid** printing any success or account name the code has not verified this run.
- **Reconcile `supabase/config.toml` against the deployed project before touching
  `device-link-start`.** Treat the deployed `verify_jwt` state as *unverified* until checked in the
  dashboard; a wrong assumption here breaks linking product-wide.

## Acceptance Criteria

- [ ] A device with valid `credentials.json` reaches `deviceLinkStart` and prints a usable code, in
      **both** the Ink and plain flows.
- [ ] Both flows obtain their banner and print/skip choice from **one** shared function; no duplicated
      copy literals.
- [ ] `runSyncOnce` returns a discriminated outcome; no call site prints `synced.` without inspecting
      it, and the Ink path reports the resync result rather than swallowing it.
- [ ] `pollForLink`'s returned credentials preserve `lastWrappedSync` and `lastCookedEventSentAt`, and
      `init` persists the creds returned by `runSyncOnce`.
- [ ] The relink poll cannot exceed 120s, and a non-TTY `init` on a linked device never blocks
      awaiting redemption.
- [ ] `link.state === 'unrecognized'` prompts an explicit confirmation naming the loss of handle,
      history and badges, before any code is printed; declining exits without minting one.
- [ ] `device-link-start` performs no write to `devices`; a missing/failed `link` object still prints
      a code.
- [ ] `cookd sync` issues no call to `device-link-start`.
- [ ] Increment A's banner never prints an unhedged cached handle.
- [ ] `Recovery.tsx` `COMMAND` is `npx @codeclowns/cookd init`, and its `token_rejected` prose no
      longer instructs an action that silently discards the account.
- [ ] `README.md:64` drops the superseded "already-linked machine syncs silently, no new press code".
- [ ] A `device_link_sessions` reaper exists.
- [ ] New `pure.test.ts` files are registered in `test.yml` **and** `package.json`.

## Next Step

This is a design decision, not an implementation plan. Next: an implementation plan against this ADR,
then `/plan-eng-review` and `/plan-design-review`. The app/backend slice is cross-referenced from
`cookd-app/docs/architecture/decisions/0010-device-link-recovery-backend.md`.
