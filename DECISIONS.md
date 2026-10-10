# DECISIONS.md

Lightweight architecture decision log. Add an entry whenever you choose between options, deviate from `plan.md`, or resolve a spike. Newest entries at the bottom. Never delete entries; mark them `Superseded by D-0XX`.

## Entry template

```
### D-XXX — Short title
- **Date:** YYYY-MM-DD
- **Status:** Accepted | Open | Superseded by D-XXX
- **Context:** what problem/ambiguity prompted this
- **Decision:** what was chosen
- **Alternatives considered:** brief
- **Consequences:** trade-offs, follow-ups, what to revisit
```

---

## Pre-seeded decisions (from plan.md)

### D-001 — Docker sandboxes instead of in-browser WASM Linux
- **Date:** (project start)
- **Status:** Accepted
- **Context:** Later worlds need real cron, sshd, process tooling, and networking.
- **Decision:** One architecture: server-side Docker container per attempt, accessed through a `SandboxProvider` interface.
- **Alternatives considered:** v86/WebVM (cheap hosting, limited features); hybrid (more engineering); Firecracker (stronger isolation, more ops).
- **Consequences:** Needs server compute and careful hardening. The interface keeps WASM or microVM providers possible later.

### D-002 — SQLite via better-sqlite3 + Drizzle for MVP
- **Date:** (project start)
- **Status:** Accepted
- **Context:** Single-VM MVP, simple ops.
- **Decision:** SQLite with Drizzle migrations.
- **Alternatives considered:** Postgres.
- **Consequences:** Single-writer; fine for MVP. Drizzle keeps a later Postgres move feasible. Back up with `sqlite3 .backup`.

### D-003 — Guest accounts via httpOnly cookie
- **Date:** (project start)
- **Status:** Accepted
- **Context:** Remove sign-up friction for beginners.
- **Decision:** `POST /api/guest` creates a user and sets a random token cookie (only the sha256 is stored).
- **Alternatives considered:** OAuth-first.
- **Consequences:** Progress is lost if cookies are cleared; OAuth upgrade path is T10.6.

### D-004 — Outcome-based validation; checks run as root with fixed env
- **Date:** (project start)
- **Status:** Accepted
- **Context:** Many valid ways to solve a task; players must not be able to tamper with checks.
- **Decision:** Declarative check types (plan §8.2) executed via root `docker exec` with `env -i` and 5 s timeouts; check scripts root-owned.
- **Consequences:** `admin` profile players with sudo could tamper with system binaries. Accepted; no competitive leaderboards in MVP.

### D-005 — Objectives are sticky by default
- **Date:** (project start)
- **Status:** Accepted
- **Context:** Players may complete an objective and then move on or clean up.
- **Decision:** Once true, an objective stays done unless `hold: true`, in which case it is re-checked at completion.
- **Consequences:** Use `hold: true` for "must still exist" (e.g. `important.txt`).

### D-006 — No stdout/stderr capture; coach uses exit code + command text
- **Date:** (project start)
- **Status:** Accepted
- **Context:** The shell is a raw PTY; capturing output reliably is invasive and fragile.
- **Decision:** Log `epoch, exit code, cwd, command` via `PROMPT_COMMAND` only.
- **Consequences:** Error coaching is approximate. Revisit if telemetry shows coaching is too vague.

### D-007 — Helper CLI `tux` talks to the server via a file inbox
- **Date:** (project start)
- **Status:** Accepted
- **Context:** Sandboxes have no network; players need a way to submit answers and request hints from inside the shell.
- **Decision:** `tux` appends JSON lines to `/run/tq/inbox`; the server tails it with a long-lived `docker exec`.
- **Consequences:** A player can write junk to the inbox; the server must validate and rate-limit parsing.

### D-008 — Cron level validation: semantic match + cron-like dry run (default)
- **Date:** (project start)
- **Status:** Open (pending SPIKE S1, T10.3)
- **Context:** Real-time cron firing makes levels slow.
- **Decision:** Default to `crontab_entry` (semantic match via `cronmatch.py`) plus `cron_dry_run` (executes the command in a cron-like minimal env). Try `libfaketime` acceleration as a spike.
- **Consequences:** If the spike works, add a `cron_fire` check type; otherwise this stays.

### D-009 — Systemd is simulated with a shim (default)
- **Date:** (project start)
- **Status:** Open (pending SPIKE S2, T10.4)
- **Context:** Real systemd needs privileges unsuited to untrusted users in containers.
- **Decision:** Python `systemctl`/`journalctl` shim supporting a documented subset; disclosed to players on the level page.
- **Consequences:** Behaviour diverges from real systemd in edge cases; keep the supported subset small and documented.

### D-010 — Anti-cheat is best-effort; no leaderboards in MVP
- **Date:** (project start)
- **Status:** Accepted
- **Context:** Seeded answers and `reset` re-seeding deter answer sharing, but players control their sandbox.
- **Decision:** Randomize answers per attempt; skip public leaderboards until a stronger isolation story exists.
- **Consequences:** Streaks and XP are personal motivation only.

---

## Agent-added decisions
_Append below this line. Continue numbering from D-011._

### D-011 — T0.1 toolchain and lint scope
- **Date:** 2026-10-05
- **Status:** Accepted
- **Context:** Host runs Node 24 + pnpm 9.15.9 (plan says Node 22 LTS); `prettier --check .` flags pre-existing docs and emitted files.
- **Decision:** Build on the host versions (engines `>=22`); root `type: module`; `pnpm lint` checks `apps packages` + root JSON/JS/TS only, leaving hand-written docs untouched until their milestones.
- **Alternatives considered:** Reformatting all docs; pinning Node 22.
- **Consequences:** No drive-by doc reformats; CI must use Node >=22; revisit if a doc milestone wants full-repo prettier.

### D-012 — better-sqlite3 v12 for Node 24 prebuilds
- **Date:** 2026-10-06
- **Status:** Accepted
- **Context:** better-sqlite3 v11 ships no win32 prebuilt for Node 24 and the host lacks VS Build Tools, so `pnpm i` failed at the native build.
- **Decision:** Depend on better-sqlite3 `^12.2.0` (has Node 24 prebuilds); keep drizzle-orm `^0.36.4` / drizzle-kit `^0.28.1`.
- **Alternatives considered:** Pinning Node 22; installing VS Build Tools; hand-rolled `node:sqlite` client (against plan.md §2).
- **Consequences:** Native install works out of the box on Node 24; v12 API is compatible with our usage (`Database`, drizzle `drizzle()`/`migrate()`/`$client`).

### D-013 — shell_cwd probe runs as player via runuser
- **Date:** 2026-10-06
- **Status:** Accepted
- **Context:** Plan §8.2 prescribes `readlink /proc/$(pgrep -o -u player -x bash)/cwd` from a root check, but §7.3's `basic` profile drops ALL caps (no `SYS_PTRACE`), so even root gets `EACCES` on a player's `/proc/*/cwd`. The two spec lines contradict each other; adding `SYS_PTRACE` would violate hard rule 3 (loosen only per the profile table).
- **Decision:** Keep the restrictive cap table untouched; run the readlink *as player* (`/usr/sbin/runuser -u player -- readlink …`). Same-UID `/proc` reads need no extra capabilities, and the exec is still root-initiated with a server-fixed, read-only command.
- **Alternatives considered:** Adding `SYS_PTRACE` to the basic profile (weakens sandbox hardening for every level); deriving cwd from the cmdlog (changes check semantics).
- **Consequences:** `shell_cwd` works under the locked-down profile; the AGENTS.md §9 gotcha now documents the runuser form.

### D-014 � Additive profile/settings API for T4.3
- **Date:** 2026-10-11
- **Status:** Accepted
- **Context:** plan.md �9.2 requires display-name edit (Profile) and reset-progress (Settings), but �6 defines no endpoints for them; badge titles live only in badges.yaml with no serving endpoint.
- **Decision:** Add three additive endpoints (no existing contract changes): PATCH /api/me {displayName 1-40}, DELETE /api/progress (wipes attempts/level_progress/skill_progress/badges + zeroes xp/streak, keeps identity and spellbook notes, abandons live session), GET /api/badges (catalog + earnedAt); add totals.hintsUsed to GET /api/progress.
- **Alternatives considered:** Dead settings buttons until a later milestone (worse); folding badge metadata into GET /api/me (churns T3.1-tested schema).
- **Consequences:** �6 table extended with a dated note; new shared schemas covered by schema + route + client tests.

### D-015 � Missing @tailwind directives left the app unstyled
- **Date:** 2026-10-11
- **Status:** Accepted
- **Context:** The T4.3 Lighthouse audit reported unstyled-UA colors (#0000ee links): apps/web/src/theme.css never contained @tailwind base/components/utilities, so no utility class ever took effect. Only :root tokens and body rules applied. Unit tests cannot catch this (jsdom ignores styles).
- **Decision:** Add the three directives at the top of theme.css; fix the resulting audit findings (keybar exact-match names, min 36px touch targets, link hit-area).
- **Alternatives considered:** None � plain bug.
- **Consequences:** First true visual render of the app; verify claimed Tailwind styling visually during the T4.3 manual check.
