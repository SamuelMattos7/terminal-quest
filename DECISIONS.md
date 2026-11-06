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

### D-021 — `exec` script paths are level-relative; runtime strips `checks/`

- **Date:** 2026-10-16
- **Status:** Accepted
- **Context:** Authoring the first `exec`-check level (w1-12) exposed a latent inconsistency: the zod schema, its test, and `levels:lint` all treat `exec.script` as level-dir-relative (`checks/verify.sh`), but `checkExec` resolved it verbatim under `/opt/tq/checks/<levelId>/` while the setup compiler uploads `checks/<name>` with the prefix stripped — so the lint-valid form would 500/miss at runtime.
- **Decision:** Strip a leading `checks/` segment in `checkExec` (after leading slashes, before the `..` guard). Bare names keep resolving as before for hand-built fixtures.
- **Alternatives considered:** Changing the convention to bare names (breaks the schema test + lint test + plan §8.1 wording); changing the compiler upload layout (touches every future level).
- **Consequences:** w1-12 uses `script: checks/verify.sh`; new docker case pins both forms.

### D-022 — Prioritize audit fixes and serialize per-user lifecycle operations

- **Date:** 2026-11-04
- **Status:** Accepted
- **Context:** The user requested audit remediation in priority order, overriding the normal first-unfinished-milestone workflow (M8). A01 shows asynchronous launches bypass capacity and single-session limits.
- **Decision:** Work on audit findings before new content. Reserve global capacity before provider creation; serialize each user's start/reset/delete operation in the app-owned live registry, including ownership/state lookup after acquiring the queue. Keep unrelated users concurrent. Use a dedicated `codex/a01-session-concurrency` branch for A01.
- **Alternatives considered:** A global launch lock (unnecessarily blocks all users); locking only provider creation (does not cover setup/registration/replacement).
- **Consequences:** Concurrent same-user starts preserve replacement semantics; stale resets return 404 after replacement. Failed operations release their queue and capacity reservation. Cleanup failure recovery remains tracked separately as A05.

### D-023 — Treat completion as an atomic active-attempt transition

- **Date:** 2026-11-04
- **Status:** Accepted
- **Context:** A02 permits closed sessions to award XP; A13 permits partial and duplicate completion writes. Both concern the boundary between an async check and authoritative persistence.
- **Decision:** Group A02/A13 on `codex/a02-completion-lifecycle`, stacked on A01. Invalidate live sessions immediately on close; require live-registry and manager ownership before/after async work. Share the per-user lifecycle queue with final completion and progress reset. Persist attempt/progress/XP/streak/skills/badges in one synchronous better-sqlite3 transaction, guarded by matching active attempt, user, level, and seed; update in-memory completion only after commit. Badge evaluation uses synchronous SQLite calls so the transaction never yields. Extract session evaluation/context to keep touched modules focused and under approximately 300 lines.
- **Alternatives considered:** Waiting for all checks during teardown (unnecessarily delays close and does not repair partial writes); async transaction callbacks (unsupported by better-sqlite3).
- **Consequences:** Already-running container checks may finish, but closed sessions cannot persist their results or execute queued checks. Failed transactions roll back and can retry; duplicate or retired attempts earn nothing. Manager removal invalidates expiry before slow Docker teardown finishes. Remaining stream/queue bounds and process termination are still A03/A04; teardown retry remains A05.

### D-024 — Bound player streams and coalesce evaluations

- **Date:** 2026-11-04
- **Status:** Accepted
- **Context:** A03 exposes unbounded host memory/work through player-written inbox/cmdlog files, retained evidence, exec output, and WebSocket traffic. The user requested A03 on its own branch with resource-limit regressions.
- **Decision:** Use `codex/a03-resource-bounds`, stacked on A02/A13. Enforce a 16 KiB WebSocket message limit (the whole UTF-8 JSON envelope, including fragmented messages), 128 messages/s/session, and the existing 64 KiB/s stdin budget across attachments. Stop queueing outbound data at 256 KiB and terminate slow sockets. Cap queued PTY input at 64 KiB and terminal output at 1 MiB/s/session. Watchers use a fixed 16 KiB raw-byte line buffer, 256 KiB/s and 128 lines/s per watched file, validating inbox and command-log fields with shared zod schemas; buffering raw bytes preserves split UTF-8. Retain at most 4096 commands/1 MiB and 256 answers/256 KiB, with 8 KiB text fields. Exceeding watcher/history/output budgets abandons the attempt and destroys its sandbox; do not evict evidence and silently alter scoring. Exec collection rejects combined stdout/stderr over 1 MiB and releases its stream buffers. Evaluations use one running operation plus one dirty bit and one shared drain promise/rejection observer.
- **Alternatives considered:** Dropping old commands/answers (changes check, rank, and badge semantics); retaining a promise per check request (still grows with slow checks); buffering all terminal output for slow clients (unbounded).
- **Consequences:** Excessive traffic is explicitly refused and abuse can end an attempt. Ordinary gameplay keeps complete evidence within the caps. Socket limits are tested with a local loopback server; the unit suite still needs no Docker. Exec process termination remains A04 and teardown retry remains A05; stream disconnection alone does not solve those findings. The watched-byte implementation also addresses the split-character defect in A28.

### D-025 — Enforce exec deadlines inside the sandbox and reap descendants

- **Date:** 2026-11-04
- **Status:** Accepted
- **Context:** A04 shows that disconnecting Docker exec only releases the host stream; commands continue running. Process-group signals alone miss detached or double-forked children. The user requested A04 on its own branch with process-termination regressions.
- **Decision:** Use `codex/a04-exec-termination`, stacked on A03. Run a Python supervisor (Python is already in tq-base) as root inside the sandbox, mark it a Linux child subreaper, and launch only the command with the requested uid/gid/supplementary groups. At the deadline, SIGKILL and reap direct/adopted children repeatedly until no descendants remain, then emit a per-exec timeout marker. The collector strips that marker and preserves the `code: -1, timedOut: true` contract, distinguishing ordinary exits 124/137. A host watchdog allows 5 seconds for cleanup/transport after the command deadline; if cleanup stalls, kill and wait for the whole sandbox, surfacing Docker failures. Successful commands retain Docker's background-service behavior: drain ready output, return the main command's status, and leave intentional services running. Process probes use `pgrep -A` to exclude their supervisor and other ancestors.
- **Alternatives considered:** Closing the stream (leaks work); GNU timeout/process groups (detached descendants escape); scanning all container processes (risks killing unrelated services); stopping the entire sandbox on every timeout (disrupts normal checks and intended services).
- **Consequences:** Timeouts report only after termination, including reaping zombies; player scripts cannot signal the root supervisor. No new image build, capabilities, host shell execution, or runtime network dependency is required. Each finite exec uses a small supervisor process. Compatibility regressions also exposed missing finite stdin forwarding on Windows named pipes; argv-safe base64 chunks now supply a temporary input descriptor with reliable EOF. Sandbox teardown retry remains A05.

### D-026 — Retain teardown ownership and unwind complete launches

- **Date:** 2026-11-04
- **Status:** Accepted
- **Context:** A05 loses container ownership and capacity accounting when Docker destruction fails, and launch cleanup covers only setup/shell failures. The user requested A05 on its own branch with teardown recovery and launch cleanup regressions.
- **Decision:** Use `codex/a05-teardown-recovery`, stacked on A04. Separate active sessions from pending sandbox cleanup: invalidate active ownership immediately, retain the handle and capacity until destruction succeeds, share in-flight destruction, and retry on periodic sweeps and shutdown. Continue sweeping other sessions after individual failures. Expiry releases the live session, socket, watchers, shell, and attempt before awaiting Docker. Remove failed-start containers immediately; if removal fails, a typed acquisition error transfers the handle to manager cleanup. Wrap all post-creation launch stages in one unwind path, preserving the original launch error while logging cleanup errors. Store watcher handles and stop every acquired resource independently, including resources returned after a startup error or expiry.
- **Alternatives considered:** Forgetting failures and relying on a restart orphan sweep (leaks capacity/resources until restart); leaving failed teardown sessions active (permits late completion); releasing capacity before Docker confirms removal (can exceed the container cap).
- **Consequences:** Unavailable Docker can keep capacity occupied until a later retry succeeds, so launches safely return 429 rather than oversubscribe. Failed launches finish opened attempts as abandoned; failed expiry teardown stays expired and cannot award XP. Shutdown retries cleanup for launches and sessions no longer present in the live registry. The separate A06 issue (installing the periodic timer when the boot orphan sweep fails) remains open.

### D-027 — Start periodic cleanup independently of boot orphan discovery

- **Date:** 2026-11-04
- **Status:** Accepted
- **Context:** A06 leaves the reaper permanently disabled if Docker fails during the boot orphan sweep; a failed listing also leaves pre-existing containers undiscovered.
- **Decision:** Use `codex/a06-reaper-startup`, branched from main after A05. Install the unref'd 30-second timer before awaiting the boot sweep. Preserve startup rejection for the app's warning, while periodic expiry and retained teardown retries continue. Retry orphan discovery on ticks until a sweep succeeds, with at most one orphan sweep in flight and failures logged independently of session sweeps. Repeated starts keep one timer; stop clears it even after startup failure or during pending discovery.
- **Alternatives considered:** Installing only in a finally block (slow boot discovery still delays expiry); timer-only recovery (failed listings leave unknown orphans until restart); permanently listing on every tick (unnecessary after successful discovery).
- **Consequences:** Docker recovery restores idle/max-age cleanup and orphan removal without a server restart. Shutdown prevents future ticks; in-flight Docker operations may finish without reinstalling the timer. No sandbox policy, API, content, or plan changes are required.

### D-028 — Serve the built web on the production API port

- **Date:** 2026-11-05
- **Status:** Accepted
- **Context:** A07 reproduces 404s for the game and its assets behind the documented Caddy proxy. The plan (§14.3) already specifies Fastify static hosting on one port.
- **Decision:** Use `codex/a07-production-delivery`, based on the completed A06 branch. The compiled entry point opts into `@fastify/static` delivery of Vite's `/assets/*` and an index fallback for GET/HEAD client navigations. Resolve the web build relative to the server module; fail startup clearly if the index is missing. Reserve API, WebSocket, health, and asset namespaces from fallback; reject encoded/dotted file paths rather than substituting HTML. Keep HTML and assets revalidatable (`max-age=0`). The tsx development entry point continues using Vite without requiring a web build.
- **Alternatives considered:** Serving the web separately with Caddy (deviates from the planned topology); unconditional static hosting in every test/development app (requires a web build for unrelated API work); a catch-all HTML response (masks missing assets and API errors).
- **Consequences:** Deployments must retain `apps/web/dist` alongside `apps/server/dist`. Production regressions require `pnpm build` first, as already ordered by `pnpm verify`; they use the compiled entry point, a temporary migrated DB, an unavailable Docker socket, and an unrelated working directory. A08 security/proxy/shutdown work and clean-VM T9.3 verification remain separate. No plan change is needed.

### D-029 — Apply production security at the compiled entry point

- **Date:** 2026-11-05
- **Status:** Accepted
- **Context:** A08 found missing Secure cookies and CSP, rate limits shared by clients behind Caddy, and signal exits that skipped cleanup.
- **Decision:** Stack `codex/a08-production-hardening` on A07. The compiled server binds to IPv4 loopback, trusts only the first forwarding hop from `127.0.0.1`, and always sets Secure guest cookies. The HTML policy allows local assets, a WebSocket at the configured public origin, and inline styles for xterm and dynamic UI styles. Both SIGTERM and SIGINT share one Fastify close operation. Begin active session cleanup before the WebSocket plugin closes connections, then await teardown and clean up any sessions created by requests that were still draining.
- **Consequences:** The documented deployment requires same-host Caddy and the external HTTPS `PUBLIC_ORIGIN`. Vite development keeps plain-HTTP cookies. The compiled-server regressions exercise Caddy-style forwarding headers and use a Docker stub for signal-driven teardown. On Windows they emit Node's signal events over IPC because Windows child-process termination bypasses those handlers.

### D-030 — Calculate completion unlocks from prior progress

- **Date:** 2026-11-05
- **Status:** Accepted
- **Context:** A09 found that the completion event calculated both sets of unlocks after the new completion was already in the database.
- **Decision:** Stack `codex/a09-completion-unlocks` on A08. Reuse the progress snapshot read for scoring inside the per-user queue and compare it with the same set plus the current level. Send the difference only after completion is recorded successfully.
- **Consequences:** First clears report newly available levels, and replays report no new unlocks. The existing modal uses the reported IDs to show its Next level button.

### D-031 — Apply the world allow-list before progression unlocks

- **Date:** 2026-11-05
- **Status:** Accepted
- **Context:** A10 found that disabling a world hid its map card while direct API requests could still open or start its levels. The release allow-list in §14.1 also applies when the developer progression override in §6 is active.
- **Decision:** Stack `codex/a10-world-availability` on A09. Return the existing unknown-level response for disabled detail, start, and owned reset requests. Restrict progression states, completion unlocks, and review candidates to enabled worlds. Review scoring uses the same candidate restriction as the review endpoint.
- **Consequences:** `UNLOCK_ALL` skips progression prerequisites within enabled worlds. Historical boss completions still qualify as prerequisites for an enabled successor world, and historical progress remains in the database.

### D-032 — Select playable daily challenges and credit UTC finishes

- **Date:** 2026-11-05
- **Status:** Accepted
- **Context:** A11 found that the daily endpoint could offer a locked level and treat a lifetime completion as completion of today's challenge.
- **Decision:** Apply the same enabled-world and unlock rules as level access before choosing a daily. An explicit `daily_eligible` value overrides the default; a lesson qualifies by default at difficulty 3 or lower after the player completes every boss in its world. Count successful attempts by this player on the selected level with an end time from the selected UTC midnight up to, but excluding, the next midnight.
- **Consequences:** Players without eligible levels get the existing empty-pool response. Attempts started on an earlier day can count if they finish on the selected date.

### D-033 — Count hints from every attempt toward Clean Sweep

- **Date:** 2026-11-05
- **Status:** Accepted
- **Context:** A12 found that attempts ending without completion lost their hint and command metrics. This undercounted profile hints and could award Clean Sweep after a hinted retry.
- **Decision:** Save hint tiers as they are issued, and write hint tiers, command count, and manual use when an attempt ends. Completed and unfinished attempts use the same command counting rules. Keep the existing Clean Sweep rule: once every level in a world is cleared, any hint taken in that world before the award disqualifies the player, even on an abandoned or expired attempt. An unsuccessful attempt with no hints does not disqualify the player.
- **Consequences:** Reset still starts a fresh attempt for scoring. Already awarded badges remain earned. The change does not backfill past attempts; command metrics reflect the command entries received before teardown.

### D-034 — Distinguish runtime failures from ordinary check results

- **Date:** 2026-11-05
- **Status:** Accepted
- **Context:** A14 found that transport, resize, setup, and evaluation errors could disappear or look like unmet objectives. Timeout reporting was limited to individual check implementations.
- **Decision:** Use pino at the session boundary with the attempt, level, and session IDs when available. Send generic client errors; keep the session usable after resize or evaluation errors, and abandon it when the shell or either watcher disconnects unexpectedly. Docker exec transport failures reject instead of returning a synthetic exit status. The check runner reports a timed-out leaf once and leaves the objective pending, including under negation. Ordinary nonzero exits retain their check-specific meaning.
- **Consequences:** Intentional teardown remains quiet. Setup failures on start and reset share the same client response, while the launch log retains the failure details. Timeouts on every exec-backed check emit the existing telemetry event without exposing probe commands or output to the client.

### D-035 — Give the latest authorized socket exclusive session control

- **Date:** 2026-11-05
- **Status:** Accepted
- **Context:** A15 found that replacing a WebSocket left the previous transport open. The adapter identity guard and session budgets already existed, but the reconnect test detached the first socket manually and bypassed the real handoff.
- **Decision:** Assign the new adapter before closing the old one with code 4409. Accept frames only from the current open transport, and let close handlers detach only their own adapter. Keep both traffic budgets on the live session. The browser treats 4409 as a final close to prevent tabs from repeatedly replacing each other.
- **Consequences:** A replacement keeps the same shell and remaining traffic allowance. Ordinary network disconnects still use the existing retry policy.

### D-036 — Resume the terminal tail and recover issued outcomes

- **Date:** 2026-11-05
- **Status:** Accepted
- **Context:** A16 found that the session snapshot could say a level was completed without restoring its result, and that hints and shell output were lost between socket attachments. Even brief opens refilled all reconnect attempts.
- **Decision:** Keep the latest 64 KiB of serialized terminal output, up to 256 frames, per live attempt. Number the frames and resume after the browser's last received sequence. Resend up to three issued hints and one committed completion result after the state snapshot. Apply them idempotently in the browser, and buffer a bounded tail until the terminal mounts. Refill the three-retry budget after 10 seconds of continuous connection.
- **Consequences:** Reconnects can restore the score and revealed hints without reissuing hints or awarding XP again. A long gap can exceed the terminal tail; the browser then receives the newest retained output. Replay ends when the live attempt closes.

### D-037 — Send finite exec input over attached Docker stdin

- **Date:** 2026-11-05
- **Status:** Accepted
- **Context:** A18 calls for attaching stdin to non-PTY execs. The A04 workaround for Windows named pipes encoded input in command arguments, which worked for small input but failed when it exceeded Linux's argument size limit.
- **Decision:** Attach stdin only when the caller supplies it, and pass its UTF-8 byte count to the supervisor. The supervisor reads exactly that many bytes into a temporary file and gives the command that file as stdin. An omitted input still uses `/dev/null`.
- **Consequences:** Commands see EOF for both empty and nonempty input without requiring a half-close on the Docker connection. Stdout and stderr remain available on Windows named pipes, and stdin contents no longer count toward the argument size limit.

### D-038 — Invalidate learning data after a level clear

- **Date:** 2026-11-05
- **Status:** Accepted
- **Context:** A22 found that the level's Notes tab could cache the Spellbook before the first clear.
- **Decision:** Invalidate both learning caches on completion and keep loading them on demand. Discard results from requests issued before invalidation. Stack A22–A24 on the A21 branch in `codex/a22-a24-audit-fixes`.
- **Consequences:** Navigating to the Spellbook or Skills fetches current data, including when an earlier request is still pending.

### D-039 — Derive the displayed streak from the UTC date

- **Date:** 2026-11-05
- **Status:** Accepted
- **Context:** A23 found that user responses displayed the stored streak after a missed day.
- **Decision:** Use the stored count in the shared user response only when the last active date is today or yesterday in UTC. Return zero for other dates.
- **Consequences:** User reads are read-only and the next completion still uses the persisted history for streak arithmetic.

### D-040 — Re-evaluate once at the idle nudge deadline

- **Date:** 2026-11-05
- **Status:** Accepted
- **Context:** A24 found that the idle nudge depended on another evaluation triggered by player activity.
- **Decision:** When an evaluation finds pending objectives and at least three failures since progress, arm one timer per attempt for the remaining wait. Use the existing evaluation queue when it fires so the current objective state determines whether to nudge. Cancel the timer on objective progress, when required objectives are done, or at session teardown.
- **Consequences:** Waiting can trigger the nudge without further input. An attempt still gets at most one nudge per period without objective progress.

### D-041 — Apply accessibility preferences to the existing xterm instance

- **Date:** 2026-11-05
- **Status:** Accepted
- **Context:** A25 found that root CSS preferences did not update xterm. A26 found that activating panel controls could send focus back to the terminal.
- **Decision:** Map the three font choices to 15, 17, and 19 px, matching the rounded page scale from xterm's 15 px default. Use a black-and-white theme with a contrast ratio target of 7 for terminal text in high-contrast mode. Turn off cursor blinking when reduced motion is enabled. Apply settings directly to xterm and refit. Keep click-to-focus for non-interactive quest-panel content.
- **Consequences:** Players can change terminal preferences without losing terminal output or reconnecting, and panel controls keep their normal focus behavior.

### D-042 — Use a native completion dialog and position the mobile keybar in the visible viewport

- **Date:** 2026-11-05
- **Status:** Accepted
- **Context:** A26 found that completion left keyboard focus on the game behind the dialog, short screens could hide actions, and the software keyboard could cover the keybar.
- **Decision:** Open a native modal dialog, focus its heading, wrap Tab among the actions, and bound its scrolling to the viewport. Keep the existing completion actions as the way out of the dialog. Restore focus to the previous element if it still exists, or to the new terminal after replay. Dock the keybar to the visible viewport and reserve its height below the page content. Keep terminal focus on touch key presses.
- **Consequences:** Completion content and actions remain reachable on short screens. The browser regression checks keyboard resize and pan through Chromium touch emulation with simulated viewport changes.

### D-043 — Validate authored release worlds and wait for Docker in browser tests

- **Date:** 2026-11-05
- **Status:** Accepted
- **Context:** A27 found that the planned World 1 and 2 CI command silently skipped unbuilt World 2, CI omitted the Docker integration suite, and an HTTP 200 did not establish browser test readiness.
- **Decision:** Reject each explicitly requested world with no levels and allow CI to assert an exact level count. Until M8, the levels job checks all 12 World 1 levels and runs the Docker integration suite using the same image build. At M8, require both worlds and 27 levels. Use the real Docker socket in integration test fixtures. Proxy the health route through Vite and require a valid health response with Docker ready. Use the gameplay Docker connection options for the health probe.
- **Consequences:** An incomplete selection fails before Docker starts. Both live Chromium tests wait for the API and Docker using the same health contract.

### D-044 — Validate release configuration and authored content before use

- **Date:** 2026-11-06
- **Status:** Accepted
- **Context:** A29 found that world-list typos were silently ignored, sandbox overrides bypassed config or had no effect, and malformed level content could pass validation. Plan §12.3 previously specified one wrong solution for bosses, while the authoring checklist specifies two.
- **Decision:** Validate each world token as a decimal ID from 1 to 5. A blank list explicitly disables every world, while an unset list defaults to Worlds 1 and 2. Deduplicate valid tokens. Pass validated sandbox overrides from server and CLI startup to the Docker provider. An explicit image override takes precedence over the level image. Validate skill references and cycles during loading and compile regex sources during schema validation. Align plan §12.3 with the authoring checklist for wrong solutions and require explain cards and cheatsheet entries in lint.
- **Consequences:** Authors can keep static instructions and fixtures in levels with generators. Lint checks both setup file sources for answers it can identify from declarative checks. The Docker level matrix remains the behavioral check for seeded data and shell scripts.

### D-045 — Share hint pricing and the effective Docker socket

- **Date:** 2026-11-06
- **Status:** Accepted
- **Context:** A30 found that hint copy always showed the first-tier penalty and xterm loaded with the initial page. A27 already aligned Docker connection options, but an app-level socket override was still applied only to gameplay.
- **Decision:** Share tier penalties between hint copy, hint delivery, and scoring. Load the Play page and xterm on demand. Resolve the Docker socket once for gameplay and the probe. Keep the existing `/healthz` response because HTTP 200 serves as liveness and consumers that need Docker check the `docker` field.
- **Consequences:** Each tier advertises its own penalty and exhausted hints show no penalty. The landing page no longer downloads xterm on initial load. The health probe checks the same configured endpoint as gameplay, including named-pipe overrides.

### D-046 — Keep operational docs at the repository root

- **Date:** 2026-11-06
- **Status:** Accepted
- **Context:** A31 found that the plan and contributor docs pointed to a nonexistent `docs/` directory. The deployment guide also used the default migration path before defining a different service database.
- **Decision:** Keep `deploy.md` and `loadtest.md` at their existing root paths and correct the references, including the paths in plan §§0, 3, and 15. Use one deployment environment file for service startup, migrations, and backups. Document World 1 and the base image as the current deployment scope.
- **Consequences:** The operational docs describe the implemented app and preserve the planned M8 and M10 work. T9.2 and T9.3 still require a measured load run and a clean-VM deployment rehearsal.

### D-047 — Check wildcard sorting with directory listings

- **Date:** 2026-11-06
- **Status:** Accepted
- **Context:** World 2 opens with a file-sorting exercise that introduces `*`, `?`, and character classes.
- **Decision:** Use fixed example filenames and exact listings for the two destinations and the inbox. Include zero- and two-character report suffixes to distinguish `?` from `*`. Use a digit class in the preview and allow any commands that produce the required layout.
- **Consequences:** The examples are consistent across attempts, and there is no seed-dependent answer to submit. The inbox check catches copying and protects the unmatched filenames.

### D-048 — Check names and entry types in the brace-expansion lesson

- **Date:** 2026-11-06
- **Status:** Accepted
- **Context:** The curriculum calls for twelve month directories and three draft files. The exercise needs a clear workspace and fixed names to teach zero padding and comma-separated choices.
- **Decision:** Start with an empty `drafts/` and put both groups directly inside it. Check the exact listing and each entry's type. Teach the two Bash forms and accept any commands that create the requested layout.
- **Consequences:** Unpadded names, swapped entry types, and extra entries keep the level incomplete. The three-seed matrix exercises the same published calendar and form names in fresh sandboxes.
