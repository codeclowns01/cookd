# Technical Scope Manifest: Device-Link Recovery

- Date: 2026-08-18
- Status: Ready for review
- Source brief: `product-hub/cookd/briefs/device-link-recovery.md`
- **Supersedes:** ADR-011 decision #4 and its acceptance criterion ("Re-running the command on an
  already-linked device syncs without showing a press code"). Everything else in ADR-011 stands.
- **Spans two repos.** Placed here because the superseded ADR and the majority of the change live in
  `cookd-companion`, which already has `docs/architecture/{decisions,manifests,plans}/` (one prior
  manifest, same naming). The `cookd-app` slice (one new edge function + app copy/navigation) is
  scoped below and should be cross-referenced from an ADR in that repo at `-decide` time, matching its
  own established `docs/architecture/` convention.

## From the Brief (do not re-derive)

JTBD: *"Let me back into my own account."* The 6-character press code is cookd's **only** credential —
no email, no password, by design. When the app session is lost, the user needs a new code, and the
laptop refuses to print one because a local file says it is already linked. The account is alive and
syncing; the human cannot get in.

Edge: an authenticated laptop is a **permanent, self-service key** to the account — recovery that is
faster than a password reset, which is what makes "no email" a differentiator rather than an excuse.

Core scope-in per the brief: always-obtainable press code, recovery instructions that actually
execute, truthful link state, the account named before redemption, an app-side escape that survives a
lost session. See the brief for the full feature set, acceptance criteria and risks.

## Repo Context Found

Read live this session (hub `codebase-map.md` marker is `71b63bc`/2026-07-12 and is **stale** — app
HEAD is `9aff6ed`; only the device-link/auth/gate areas were re-verified, and `sources.md` records this).

- **`cookd-companion`** @ `bd3a590` — TypeScript, Node ≥20, Commander CLI, Ink for TTY UI, Vitest
  (158 tests). `src/commands/init.tsx` carries two parallel flows (Ink + plain/non-TTY) that must stay
  behaviourally identical. `src/commands/init-guard.ts` holds the superseded predicate.
  `src/auth/credentials.ts` owns `~/.cookd/credentials.json` (0600). `src/sync/run.ts` `runSyncOnce()`
  returns `{ synced: boolean }` that collapses **four** distinct outcomes (no adapter / signature
  unchanged / growth gate / push failed). `src/sync/client.ts` already computes a real `PushOutcome`
  (`ok | token_rejected | network`) and discards it at the boundary. `src/hooks/settings.ts`
  `hasCookdHook()` exists and is consulted only by `sync/health.ts`, never by the consent prompt.
- **`cookd-app`** @ `9aff6ed` — Expo 54 / RN 0.81, TS strict, Jest; Supabase (Postgres + Deno edge
  functions). `devices.token_hash` is `not null unique` (migration 0001) — the probe's lookup is a
  single indexed read. `device_link_sessions` (0020) is transient with a 10-minute TTL.
  Migration 0024 derives `freshness` + `freshness_reason` and already names the exact state
  vocabulary the CLI needs to report against: `never_linked`, `token_rejected`, `laptop_silent`,
  `version_too_old`, `hook_not_installed`.
- **Load-bearing finding — the recovery primitive is already built and was unreachable.**
  `device-link-start` accepts the companion's bearer and pre-authenticates the link session to that
  account; `device-link-confirm` evaluates `session.user_id` **before** the app's JWT, mints fresh app
  tokens for that account, and `Entrance.tsx` calls `setSession()` with them. **The app adopts the
  laptop's account** — this is not a rebind of the device to the app's account. Nothing new needs to
  be built for the core recovery path; the withholding branch simply has to stop standing in front of it.
- **Corrected assumption:** a revoked/unknown bearer does **not** 401 at `device-link-start` —
  `maybeSingle()` finds no device, `preAuthedUserId` stays null, and the flow silently falls through to
  the fresh-link branch that creates a brand-new account.
- **Independent confirmed defect:** `Recovery.tsx:30` prescribes `npx @codeclowns/cookd` with no `init`
  subcommand. Verified by execution: prints help, exits 0, recovers nothing. All five reason branches
  use it; `README.md:64` repeats it.

## Performance / Scale Envelope

**No scale question asked — not load-bearing here, and the answer could not change the manifest.**
The one new server call is a single lookup on an existing unique index (`devices.token_hash`),
issued at `init` frequency (human-initiated, order of once per day per user at most) and optionally
on sync. Scale class is unchanged from ADR-011's "Modest" finding. Latency budget: the probe must not
make `init` feel slower than today — it is one round trip added to a flow that already makes at least
two, so treat a normal-network budget of ~1s as sufficient and make the probe **non-fatal**: if it
fails or times out, `init` proceeds and prints the code, because a probe outage must never re-create
the lockout it exists to prevent. That fallback is a hard invariant, not a preference.

## Data-Consistency Tolerance

**Fully stale-tolerant, with one exception.**

The probe answers "is this token valid and whose is it?" — a fact that changes only on revocation or
account deletion, both rare. A stale-by-seconds answer is harmless. Existing sync remains
at-least-once and idempotent per ADR-011; nothing here changes that.

The **exception, where staleness is not tolerable**: the account name shown next to a press code. If
the CLI prints "this will sign you into @A" and the code actually lands in @B, the user has been
actively misled about an identity operation. That string must come from the same authority that will
service the redemption, not from the cached `handle` in `credentials.json` (which is written once at
link time and never refreshed). Concrete failure mode: a user changes their handle in-app, then
relinks, and the CLI confidently names a handle that no longer exists.

**Second concrete failure mode, now a decided behaviour:** a rejected token must stop being reported
as `synced.` The CLI currently prints success over a 401 because `runSyncOnce` discards the
`PushOutcome` that `client.ts` already computed.

## Core Wedge

**A linked laptop can always mint a working press code, and never lies about the link's state.**

Smallest production-shippable slice, in two shippable increments:

- **Increment A (hotfix, unblocks the Play Store cohort):** remove the withholding branch in both
  `init` paths; correct the repair command in `Recovery.tsx` and `README.md`; name the target account
  from the credentials already on hand. No new endpoint, no schema change, no app navigation change.
  This alone satisfies the brief's primary acceptance criteria.
- **Increment B (the reconciliation):** the device-status probe; the honest `runSyncOnce` outcome; the
  de-emphasised-when-healthy code block; `cookd logout`; the Lock sign-out confirmation and the
  app-side escape.

**Cut to reach it:** `--new-account` (decided out — see below); press-code attempt-limiting; the
`DEMO00` shared-credential removal; any multi-device management UI; any change to the access-time
formula or the Lock gate itself; reconciling `demo-usage-sim` vs `cookd-companion` drift.

## Decisions Made This Stage (founder answers, 2026-08-18)

1. **Revoked token (`token_rejected`) → warn loudly, then create a new account.** Keeps the behaviour
   that already exists but ends its silence: the CLI must state that the old credentials are dead and
   that continuing abandons the previous handle, history and badges, and must require an explicit
   confirmation before proceeding. *Rejected:* recovering the original account via `deviceId`
   (promotes a plaintext, non-secret identifier to a credential); blocking and requiring app-side
   relink (useless precisely when the user is locked out).
2. **Press code is always obtainable, de-emphasised when the probe reports healthy.** The guarantee
   stays unconditional; only its prominence is conditional. *Rejected:* showing it only when the probe
   reports a fault — that re-introduces a branch that withholds the code based on an inference, which
   is the exact bug class being fixed, and it fails closed into a lockout whenever the probe is wrong.
3. **Lock-screen `signOut()` stays, behind a confirmation naming the consequence.** *Rejected:*
   removing it (a user with a genuinely dead companion could then never abandon the session).
4. **`--new-account` will NOT be built.** *Derived consequence, not re-interviewed:* this promotes
   `cookd logout` from *could* to **must** — it becomes the only way to release a machine, and
   therefore a hard dependency of the tester workflow rather than optional hygiene. Local-only
   credential clearing is sufficient: a subsequent `init` sends no bearer, so `device-link-start`
   leaves `preAuthedUserId` null and the existing fresh-link branch creates the new account. No
   server-side revocation is implied, and the orphaned `devices` row is harmless because it cannot be
   used without the token.

## Explicitly In Scope

Companion: remove the withholding branch in both `init` paths (Ink + plain); surface the real
`PushOutcome` from `runSyncOnce`; call the status probe non-fatally; name the target account from a
live source; the revoked-token warning + confirmation; `cookd logout`; suppress the auto-sync consent
re-prompt when `hasCookdHook()` is already true.

App/backend: one device-status read endpoint; `Recovery.tsx` + `README.md` command correction; the
Lock sign-out confirmation; an escape from Lock/Entrance that survives a lost session.

## Explicitly Out of Scope / Deferred

Email, password or OAuth recovery of any kind (dissolves the edge — recorded as a rejected direction
in the hub, do not re-propose); `--new-account`; press-code attempt-limiting on `device-link-confirm`;
the `DEMO00` hardcoded shared credentials shipped in the APK (both named as real security work,
tracked separately, neither blocking recovery); multi-device management UI; access-formula or Lock-gate
changes; `demo-usage-sim` vs `cookd-companion` drift; corrupt-`credentials.json` duplicate-device-row
handling (brief item 13, deferred).

## Open Questions / Risks Flagged for Review

- **Endpoint shape and placement** — deliberately not decided here. Whether device-status is a new
  edge function or an extension of an existing one, what it returns, and whether `sync` also calls it
  (versus `init` only) is `-decide`'s call. Constraint from this stage: it must be non-fatal on
  failure.
- **Where the authoritative handle comes from** — the consistency section rules out the cached
  `credentials.json` handle for the "you will be signed into @X" string, but the source is a design
  question for `-decide` (probe response vs. a field on an existing response).
- **Increment split** — whether A ships as its own release before B is a sequencing call with real
  consequences: A is a three-line change that unblocks a blocked tester cohort today, B is a week of
  work. Flagged for `-decide` and `/plan-eng-review`.
- **Carried, unvalidated (from the brief):** possession of the laptop is accepted as sufficient proof
  of identity for full account access. Already true today (the token file *is* the credential), so this
  work adds no new exposure — but printing a code on every run widens the window in which one can be
  captured from a shared screen or over a shoulder. Named so it is a decision, not an inheritance.
- **Risk:** `init.tsx` maintains two parallel flows (Ink and plain/non-TTY) that have already drifted
  once — the superseded guard over-offered auto-sync on one path and never offered it on the other.
  Any change here must be applied to both or the drift recurs. Candidate for `/plan-eng-review`.
- **Risk:** superseding a shipped ADR's acceptance criterion leaves ADR-011's own verification record
  (which lists AC5 as implemented ✅) asserting the opposite of the running behaviour. `-decide` must
  supersede formally rather than edit ADR-011 in place.
- **Not asked, recorded instead:** scale/latency envelope and consistency tolerance were both derived
  rather than interviewed (see those sections for the explicit assumptions made and why no plausible
  answer would have changed this manifest).
