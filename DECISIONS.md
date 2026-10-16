# DECISIONS.md

Lightweight architecture decision log. Add an entry whenever you choose between options, deviate from `plan.md`, or resolve a spike. Newest entries at the bottom. Never delete entries; mark them `Superseded by D-0XX`.

## Entry template

```
### D-XXX â€” Short title
- **Date:** YYYY-MM-DD
- **Status:** Accepted | Open | Superseded by D-XXX
- **Context:** what problem/ambiguity prompted this
- **Decision:** what was chosen
- **Alternatives considered:** brief
- **Consequences:** trade-offs, follow-ups, what to revisit
```

---

## Pre-seeded decisions (from plan.md)

### D-001 â€” Docker sandboxes instead of in-browser WASM Linux

- **Date:** (project start)
- **Status:** Accepted
- **Context:** Later worlds need real cron, sshd, process tooling, and networking.
- **Decision:** One architecture: server-side Docker container per attempt, accessed through a `SandboxProvider` interface.
- **Alternatives considered:** v86/WebVM (cheap hosting, limited features); hybrid (more engineering); Firecracker (stronger isolation, more ops).
- **Consequences:** Needs server compute and careful hardening. The interface keeps WASM or microVM providers possible later.

### D-002 â€” SQLite via better-sqlite3 + Drizzle for MVP

- **Date:** (project start)
- **Status:** Accepted
- **Context:** Single-VM MVP, simple ops.
- **Decision:** SQLite with Drizzle migrations.
- **Alternatives considered:** Postgres.
- **Consequences:** Single-writer; fine for MVP. Drizzle keeps a later Postgres move feasible. Back up with `sqlite3 .backup`.

### D-003 â€” Guest accounts via httpOnly cookie

- **Date:** (project start)
- **Status:** Accepted
- **Context:** Remove sign-up friction for beginners.
- **Decision:** `POST /api/guest` creates a user and sets a random token cookie (only the sha256 is stored).
- **Alternatives considered:** OAuth-first.
- **Consequences:** Progress is lost if cookies are cleared; OAuth upgrade path is T10.6.

### D-004 â€” Outcome-based validation; checks run as root with fixed env

- **Date:** (project start)
- **Status:** Accepted
- **Context:** Many valid ways to solve a task; players must not be able to tamper with checks.
- **Decision:** Declarative check types (plan Â§8.2) executed via root `docker exec` with `env -i` and 5 s timeouts; check scripts root-owned.
- **Consequences:** `admin` profile players with sudo could tamper with system binaries. Accepted; no competitive leaderboards in MVP.

### D-005 â€” Objectives are sticky by default

- **Date:** (project start)
- **Status:** Accepted
- **Context:** Players may complete an objective and then move on or clean up.
- **Decision:** Once true, an objective stays done unless `hold: true`, in which case it is re-checked at completion.
- **Consequences:** Use `hold: true` for "must still exist" (e.g. `important.txt`).

### D-006 â€” No stdout/stderr capture; coach uses exit code + command text

- **Date:** (project start)
- **Status:** Accepted
- **Context:** The shell is a raw PTY; capturing output reliably is invasive and fragile.
- **Decision:** Log `epoch, exit code, cwd, command` via `PROMPT_COMMAND` only.
- **Consequences:** Error coaching is approximate. Revisit if telemetry shows coaching is too vague.

### D-007 â€” Helper CLI `tux` talks to the server via a file inbox

- **Date:** (project start)
- **Status:** Accepted
- **Context:** Sandboxes have no network; players need a way to submit answers and request hints from inside the shell.
- **Decision:** `tux` appends JSON lines to `/run/tq/inbox`; the server tails it with a long-lived `docker exec`.
- **Consequences:** A player can write junk to the inbox; the server must validate and rate-limit parsing.

### D-008 â€” Cron level validation: semantic match + cron-like dry run (default)

- **Date:** (project start)
- **Status:** Open (pending SPIKE S1, T10.3)
- **Context:** Real-time cron firing makes levels slow.
- **Decision:** Default to `crontab_entry` (semantic match via `cronmatch.py`) plus `cron_dry_run` (executes the command in a cron-like minimal env). Try `libfaketime` acceleration as a spike.
- **Consequences:** If the spike works, add a `cron_fire` check type; otherwise this stays.

### D-009 â€” Systemd is simulated with a shim (default)

- **Date:** (project start)
- **Status:** Open (pending SPIKE S2, T10.4)
- **Context:** Real systemd needs privileges unsuited to untrusted users in containers.
- **Decision:** Python `systemctl`/`journalctl` shim supporting a documented subset; disclosed to players on the level page.
- **Consequences:** Behaviour diverges from real systemd in edge cases; keep the supported subset small and documented.

### D-010 â€” Anti-cheat is best-effort; no leaderboards in MVP

- **Date:** (project start)
- **Status:** Accepted
- **Context:** Seeded answers and `reset` re-seeding deter answer sharing, but players control their sandbox.
- **Decision:** Randomize answers per attempt; skip public leaderboards until a stronger isolation story exists.
- **Consequences:** Streaks and XP are personal motivation only.

---

## Agent-added decisions

_Append below this line. Continue numbering from D-011._

### D-011 â€” T0.1 toolchain and lint scope

- **Date:** 2026-10-05
- **Status:** Accepted
- **Context:** Host runs Node 24 + pnpm 9.15.9 (plan says Node 22 LTS); `prettier --check .` flags pre-existing docs and emitted files.
- **Decision:** Build on the host versions (engines `>=22`); root `type: module`; `pnpm lint` checks `apps packages` + root JSON/JS/TS only, leaving hand-written docs untouched until their milestones.
- **Alternatives considered:** Reformatting all docs; pinning Node 22.
- **Consequences:** No drive-by doc reformats; CI must use Node >=22; revisit if a doc milestone wants full-repo prettier.

### D-012 â€” better-sqlite3 v12 for Node 24 prebuilds

- **Date:** 2026-10-06
- **Status:** Accepted
- **Context:** better-sqlite3 v11 ships no win32 prebuilt for Node 24 and the host lacks VS Build Tools, so `pnpm i` failed at the native build.
- **Decision:** Depend on better-sqlite3 `^12.2.0` (has Node 24 prebuilds); keep drizzle-orm `^0.36.4` / drizzle-kit `^0.28.1`.
- **Alternatives considered:** Pinning Node 22; installing VS Build Tools; hand-rolled `node:sqlite` client (against plan.md Â§2).
- **Consequences:** Native install works out of the box on Node 24; v12 API is compatible with our usage (`Database`, drizzle `drizzle()`/`migrate()`/`$client`).

### D-013 â€” shell_cwd probe runs as player via runuser

- **Date:** 2026-10-06
- **Status:** Accepted
- **Context:** Plan Â§8.2 prescribes `readlink /proc/$(pgrep -o -u player -x bash)/cwd` from a root check, but Â§7.3's `basic` profile drops ALL caps (no `SYS_PTRACE`), so even root gets `EACCES` on a player's `/proc/*/cwd`. The two spec lines contradict each other; adding `SYS_PTRACE` would violate hard rule 3 (loosen only per the profile table).
- **Decision:** Keep the restrictive cap table untouched; run the readlink _as player_ (`/usr/sbin/runuser -u player -- readlink â€¦`). Same-UID `/proc` reads need no extra capabilities, and the exec is still root-initiated with a server-fixed, read-only command.
- **Alternatives considered:** Adding `SYS_PTRACE` to the basic profile (weakens sandbox hardening for every level); deriving cwd from the cmdlog (changes check semantics).
- **Consequences:** `shell_cwd` works under the locked-down profile; the AGENTS.md Â§9 gotcha now documents the runuser form.

### D-014 — Additive profile/settings API for T4.3

- **Date:** 2026-10-11
- **Status:** Accepted
- **Context:** plan.md §9.2 requires display-name edit (Profile) and reset-progress (Settings), but §6 defines no endpoints for them; badge titles live only in badges.yaml with no serving endpoint.
- **Decision:** Add three additive endpoints (no existing contract changes): PATCH /api/me {displayName 1-40}, DELETE /api/progress (wipes attempts/level_progress/skill_progress/badges + zeroes xp/streak, keeps identity and spellbook notes, abandons live session), GET /api/badges (catalog + earnedAt); add totals.hintsUsed to GET /api/progress.
- **Alternatives considered:** Dead settings buttons until a later milestone (worse); folding badge metadata into GET /api/me (churns T3.1-tested schema).
- **Consequences:** §6 table extended with a dated note; new shared schemas covered by schema + route + client tests.

### D-015 — Missing @tailwind directives left the app unstyled

- **Date:** 2026-10-11
- **Status:** Accepted
- **Context:** The T4.3 Lighthouse audit reported unstyled-UA colors (#0000ee links): apps/web/src/theme.css never contained @tailwind base/components/utilities, so no utility class ever took effect. Only :root tokens and body rules applied. Unit tests cannot catch this (jsdom ignores styles).
- **Decision:** Add the three directives at the top of theme.css; fix the resulting audit findings (keybar exact-match names, min 36px touch targets, link hit-area).
- **Alternatives considered:** None — plain bug.
- **Consequences:** First true visual render of the app; verify claimed Tailwind styling visually during the T4.3 manual check.

### D-016 — w1-01 guidance via shell greeting instead of UI pre-fill

- **Date:** 2026-10-12
- **Status:** Accepted
- **Context:** plan.md §11.3 specifies w1-01 as 'Guided: UI pre-fills echo hello', but no pre-fill mechanism exists (T4.2 terminal starts empty) and building one is out of proportion for a two-command tutorial.
- **Decision:** Guide the first keystroke with an rc_extra shell greeting plus explicit story text, instead of pre-filled input.
- **Alternatives considered:** Building initial-input support into TerminalView/useSession (real scope, saved for a future UX pass if telemetry shows w1-01 friction).
- **Consequences:** Minor deviation from the §11.3 table note; T5.2 e2e types both commands manually so the gate is unaffected.

### D-017 � Review timing units and server-side replay inference (T6.1)

- **Date:** 2026-10-13
- **Status:** Accepted
- **Context:** creditSkills writes lastUsedAt in unix seconds but reviewDue compared against Date.now() ms, so every learned skill was always due; and the 25%-XP review rule needed a way to recognise replays.
- **Decision:** Standardize the review path on unix seconds; infer review replays server-side (level due at completion time) with no protocol change; review replays award round(base*0.25) with bests preserved by max.
- **Alternatives considered:** Explicit client replay flag (contract churn); data migration to ms (heavier, same outcome).
- **Consequences:** /api/review becomes accurate (previously over-eager); plain repeats keep improvement-over-best.

### D-018 — Restore man pages in tq-base (B0 spike finding)

- **Date:** 2026-10-16
- **Status:** Accepted
- **Context:** B0 spike for M7 showed `man <anything>` fails in `tq-base` ("No manual entry"): debian:12-slim strips `/usr/share/man` via a dpkg path-exclusion, so the `man-db`/`manpages` packages installed empty. w1-10 (Manual Labor) and the bundled `tldr` fallback both need a working `man`.
- **Decision:** In the base Dockerfile, delete the dpkg exclusion and `apt-get install --reinstall` the toolset so their pages land on disk (mandb rebuilt by the man-db trigger).
- **Alternatives considered:** Designing w1-10 around `--help` only (weakens the `man` teaching beat the curriculum requires); running `mandb` per-level in setup (slow, fragile).
- **Consequences:** Image grows by the man pages (~tens of MB); requires `pnpm images:build` + a full `levels:test --world 1` re-run to confirm nothing regressed.

### D-019 — `answer_equals` matches any submitted answer, not just the latest

- **Date:** 2026-10-16
- **Status:** Accepted
- **Context:** plan.md §8.2 defines `answer_equals` as "compares latest `tux submit` text". That works live (the server re-evaluates after every command, so each submit is briefly "latest" and stickiness keeps it), but `levels:test` drives the whole solution then evaluates once — so multi-answer levels (w1-09 now, w2-15 boss later: `answer_equals` ×4) can never complete in the harness: only the last answer matches.
- **Decision:** `checkAnswerEquals` passes if **any** submitted answer matches (after trim/case rules). Live behavior is unchanged for sticky objectives (the only realistic kind for answers): a correct submit still completes immediately and stays done; a later wrong submit cannot un-complete it.
- **Alternatives considered:** Per-line evaluation in `levels:test` (harness restructure + slower runs for harness/production fidelity); single-answer-per-level design constraint (breaks the w2-15 curriculum row).
- **Consequences:** Deviates from the §8.2 one-liner; noted with a dated annotation in plan.md §8.2. New unit cases cover multi-answer accumulation.

### D-020 — Gate the e2e smoke on API readiness, not just vite

- **Date:** 2026-10-16
- **Status:** Accepted
- **Context:** CI `e2e` failed twice on PR #13 (B2) while #12 was green with no related code change. Local repro showed `POST /api/guest` proxy-500ing ~1 s after page load: Playwright's `webServer.url` only proves vite (:5173) is up, but the spec clicks "Start playing" immediately while the tsx API server (:3001) can still be booting — a pre-existing race since T5.2 that finally hit.
- **Decision:** Poll `GET /healthz` (public; also proves Docker reachability) up to 90 s before the first click in `e2e/smoke.spec.ts`. No assertion or flow changed.
- **Alternatives considered:** Waiting on `:3001` in the webServer config (Playwright supports one URL only; the spec-side gate is equivalent and keeps the failure message local to the test).
- **Consequences:** The M5 gate no longer depends on boot-timing luck; verified with back-to-back local `pnpm e2e` greens after a failing run.
