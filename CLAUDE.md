# Claude Map Protocol

This project has a persistent intelligence map.
Map location: `~/.claude-map/projects/cookd/`
The map is the source of truth for dependencies, conventions, and change impact.
When in doubt between the map and your own inference — trust the map, flag the discrepancy.

---

## EVERY SESSION — Do this before anything else

Read these two files at the start of every session, without exception:

- `~/.claude-map/projects/cookd/_sessions.md` — what happened last session
- `~/.claude-map/projects/cookd/_index.md` — clusters, critical nodes, guardrail highlights

Then, for every file you plan to touch this session:

- Read its map entry at `~/.claude-map/projects/cookd/map/[file].md`

If a file you plan to touch has no map entry, create a stub for it before proceeding.
Use the standard map template from the bootstrap. Mark it `Confidence: unknown` until you can fill it in.

---

## BEFORE MAKING ANY CHANGE

For each file you are about to change:

### Step 1 — Check the guardrails
Read the guardrail themes listed in that file's map entry.
Load the relevant fragment from `~/.claude-map/projects/cookd/guardrails/[theme].md`.
If the change you are about to make would violate a guardrail, stop and flag it to the user before proceeding.
Do not silently work around a guardrail.

### Step 2 — Determine if this is an interface change or implementation change
Read the "Interface vs Implementation" section of the file's map entry.

- **Implementation change** (internal logic only, nothing exported changes): proceed. No downstream review needed.
- **Interface change** (exported functions, API shape, types, env vars, response format): go to Step 3.

### Step 3 — Walk the downstream list (interface changes only)
Read the "Downstream Dependents" list in the file's map entry.
For each downstream file listed:

- Check whether the change affects that file's dependency on this one
- If yes: flag it to the user as a required co-change or review
- If no: note it as reviewed and unaffected

Say explicitly to the user: "This is an interface change. Downstream files that need review: [list]. Files reviewed and unaffected: [list]."
Do not proceed until the user acknowledges.

---

## THE APPROVAL GATE

When you have made changes and are ready to present them to the user:

1. Show the changes clearly
2. State which downstream files were reviewed and what was found
3. State which guardrails were checked and whether any were flagged
4. Then explicitly ask: "Do you approve these changes? I will update the map after your confirmation."

Do not update any map file before the user says yes.
"Looks good", "yes", "go ahead", "do it", "approved" all count as approval.
If unclear, ask: "Should I update the map now?"

---

## AFTER THE USER APPROVES — Map update sequence

Perform these steps in order:

### 1. Update the changed file's map entry
Open `~/.claude-map/projects/cookd/map/[changed-file].md`
Update: Purpose (if it changed), Upstream, Downstream, Interface vs Implementation, Change Triggers.
Set: `Confidence: verified`, update the Last updated date.

### 2. Flag downstream maps as needing review (do not rewrite them)
For each downstream file that was affected:
Add this line at the top of its map entry, below the header:
```
> ⚠️ STALE — upstream file [changed-file] was modified on [DATE]. Review this map entry.
```
Do not rewrite the downstream map. Just flag it. The user or a future session will verify.

### 3. Update `_guardrails.md` if needed
If this session revealed a new convention not yet in `_guardrails.md`, add it now with source + date.
If a session revealed a guardrail that no longer reflects reality, do NOT silently update it.
Go to step 4 instead.

### 4. Log any conflicts to `_conflicts.md`
If any of the following occurred this session, add a row to `_conflicts.md`:

- A guardrail was found to conflict with actual code
- The map said X depends on Y but it actually depends on Z
- A file was renamed or deleted but its map entry still exists
- Two guardrails contradict each other

Format:
```
| [DATE] | [file or rule] | [describe the contradiction] | Awaiting user |
```

Then tell the user: "I've logged a conflict in `_conflicts.md` that needs your decision: [brief description]."

### 5. Handle renamed or deleted files
**If a file was renamed:** rename its map entry file to match, update all map entries that referenced the old path, add a conflict log noting the rename.
**If a file was deleted:** move its map entry to a `_archived/` subfolder (do not delete it), update all map entries that referenced it, add a conflict log.

### 6. Handle new files
If a new file was created this session:
Create its map entry immediately using the standard map template.
Determine its tier (Hub / Standard / Leaf / Frozen) based on its role.
Add it to the relevant cluster in `_index.md`.

### 7. Append to `_changelog.md`
```
---
**[DATE] | [brief session label, e.g. "feature/oauth-flow"]**
Changed: [list of files changed]
New files: [list or "none"]
Map entries updated: [list]
Map entries flagged as stale: [list or "none"]
Guardrails updated: [yes/no — if yes, what]
Conflicts logged: [yes/no — if yes, summary]
---
```

### 8. Append to `_sessions.md`
Write one paragraph (3–6 sentences) describing what happened this session:

- What was worked on
- What clusters were touched
- What was left incomplete or uncertain
- What the next session should know or do first

---

## CONTRADICTION HANDLING

If at any point you notice a contradiction between the map and reality:

**Map says one thing, code says another:**
Do not silently update the map to match the code — the code might be the mistake.
Log to `_conflicts.md` and flag to the user: "The map says [X] but I'm seeing [Y] in the code. Which is correct?"

**Two guardrails contradict each other:**
Do not choose one silently. Log to `_conflicts.md` and flag to the user.

**A file referenced in a map no longer exists:**
Log to `_conflicts.md`. Ask the user: "Map entry for [file] references [missing file]. Was it renamed, deleted, or is the map wrong?"

**A downstream file seems unaffected but you're not certain:**
Mark it as `reviewed — uncertain` in your session notes and log to `_sessions.md`. Do not mark it verified.

---

## RENAME AND DELETE RULES

These are map events, not just code events. Treat them accordingly.

**File renamed:**
- Rename the `.map.md` file in `map/` to match the new path
- Search all other `.map.md` files for references to the old path and update them
- Add a row to `_conflicts.md` noting the rename and confirming the map was updated
- Update `_index.md` if the file appears in any cluster

**File deleted:**
- Move the `.map.md` to `~/.claude-map/projects/cookd/map/_archived/`
- Search all other `.map.md` files for references to this file and annotate them
- Add a row to `_conflicts.md` noting the deletion

---

## INDEX REFRESH TRIGGER

Refresh `_index.md` clusters and critical nodes when any of the following occurs:

- 3 or more files in the same cluster were modified in one session
- A new Hub-tier file was added
- A cluster's core file was significantly restructured
- The user explicitly asks to re-cluster

When refreshing: re-read all map entries in the affected cluster, update the cluster description and high-risk file, recalculate critical nodes by downstream count.

---

## GUARDRAIL RULES

- Every guardrail entry in `_guardrails.md` must have a source reference and a last verified date
- If you apply a guardrail and it still holds, update its last verified date
- If a guardrail has not been verified in 90+ days, flag it to the user as potentially stale before relying on it
- Never remove a guardrail from `_guardrails.md` without user approval — log a conflict instead

---

## MAP DEPTH GUIDE

When creating or updating map entries, use these depth guidelines:

| Tier | When to use | What to include |
|------|-------------|-----------------|
| Hub | Entry points, shared types/interfaces, heavily depended-on files | Full template — all sections |
| Standard | Regular source files | Standard template — all sections |
| Leaf | Files with no downstream dependents | Shallow template — Purpose + Downstream only |
| Frozen | Vendor, generated, compliance-sensitive | Frozen template — Purpose + Frozen flag only |

When in doubt about tier: if the file has 2+ downstream dependents, it is at least Standard.
If it has 5+ downstream dependents or defines shared interfaces, it is Hub.

---

## QUICK REFERENCE — What to do when

| Situation | Action |
|-----------|--------|
| Starting a session | Read `_sessions.md` + `_index.md` + relevant map entries |
| About to touch a file | Read its map entry |
| About to change an export | Walk downstream list, flag to user |
| Guardrail violation found | Stop, flag to user, do not proceed silently |
| Contradiction found | Log to `_conflicts.md`, flag to user |
| User approves changes | Run map update sequence (8 steps above) |
| New file created | Create map stub immediately |
| File renamed or deleted | Treat as a map event, follow rename/delete rules |
| Map entry is missing | Create stub before touching the file |
| Downstream unclear | Mark uncertain in `_sessions.md`, do not guess |
| Index feels stale | Check refresh trigger conditions |
