# PROGRESS.md

Single source of truth for build status. Tick a box only when the task's acceptance criteria in `plan.md §15` are demonstrably met, and add a short evidence note (e.g. `pnpm verify green, 14 tests`).

**Legend:** `[ ]` not started · `[~]` in progress · `[x]` done · `[!]` blocked (see Blockers)

**Current focus:** Audit remediation: A01–A25 and A28 fixed. A26 is the next open audit finding. M8 is the next unfinished milestone (M5 gate green).

---

## Milestones

### M0 — Scaffold

- [x] T0.1 Monorepo, tooling, empty skeletons build; `/healthz` works ✅ pnpm verify green, 3 tests; /healthz live {ok:true,docker:false}; web :5173 200 (Node 24 / pnpm 9.15.9)
- [x] T0.2 `packages/shared` zod schemas (protocol, level, checks) + tests ✅ pnpm verify green, 35 tests (34 shared: checks 17, level 7, protocol 6, api 4)
- [x] T0.3 DB schema + migrations + client ✅ pnpm verify green, 38 tests; pnpm db:migrate creates all 8 tables (verified on scratch DB)
- [x] T0.4 CI workflow (`verify`, `levels`, `e2e` jobs) ✅ actionlint 1.7.7 clean, verify job defined; pnpm verify green, 38 tests

### M1 — Sandbox

- [x] T1.1 `tq-base` image + `/opt/tq` helpers (`bashrc`, `tux`, cheats) ✅ images:build ok; whoami=player, bin={tux,tldr,modeof.sh}; sudo/su denied, /opt/tq ro, secret 700; tux submit JSON ok
- [x] T1.2 `DockerProvider` + security profiles (+ `test:docker` script) ✅ 6 docker tests green (~1s); uid 1000, net none, 256M label, destroy clean, shell echo; pnpm test Docker-free (38)
- [x] T1.3 `SessionManager` + reaper (idle, max-age, orphan sweep, capacity) ✅ 7 fake-clock tests green; idle/max-age sweep destroys, orphans swept, CapacityError at cap; 45 total, Docker-free

### M2 — Level engine

- [x] T2.1 `levelLoader` + `levels:lint` ✅ lint green on w1-02 sample; 10 new tests (loader 4, lint 6) reject bad YAML/schema/dupes/dir/order/skills/files; 55 total
- [x] T2.2 `setupCompiler` + seeded generators run in sandbox ✅ seeds 1≠2 answers, cmdlog writable, secret hidden; 5 compiler + 2 docker tests; 60 unit + 8 docker green
- [x] T2.3 Core check types (file/process/port/answer/cwd/command/combinators/exec) ✅ 22 docker tests pass+fail per type; shell_cwd via runuser (D-013), pgrep self-match fix; 60 unit + 26 docker green
- [x] T2.4 `ObjectiveTracker`, cmdlog parser, tux inbox, scoring, hints, coach ✅ 25 new Docker-free tests (scoring 9, coach 5, tracker 5, cmdlog 5, hints 1); 85 total
- [x] T2.5 `script_tests`, `crontab_entry`, `cron_dry_run`, `login_shell_eval`, `cronmatch.py` ✅ 7 new docker tests (cronmatch equiv, entry, dry-run rel-path fail, script cases, shellcheck, login env); 85 unit + 33 docker green
- [x] T2.6 `tools/level-runner` (`levels:test`) ✅ w1-02 matrix baseline-fail/wrong-fail/reference-pass ×3 seeds; CI levels job blocking; 85 unit + 34 docker green

### M3 — Server API & socket

- [x] T3.1 Guest auth, `me`, `worlds`, `levels/:id` public DTO, unlock logic ✅ 19 new tests (auth 4, worlds 5, levels 2, xp 4, unlock 4); DTO leak scan, 429 rate limit; 104 total
- [x] T3.2 `start` / `reset` / `DELETE session` + WebSocket wiring ✅ ws client solves w1-02 via stdin → objective frames + level_complete (S, 55xp); 4401/4403, oversize/ping, replace/reset/abandon, 429+Retry-After; 106 unit + 43 docker green
- [x] T3.3 Persistence: attempts, progress, skills, XP, badges, streaks, spellbook, daily, review ✅ 24 new tests (repeat-XP via scoring, streaks, skills, badges, review/daily, 6 endpoints); 130 unit + 43 docker green

### M4 — Web client

- [x] T4.1 Theme, routing, API client, stores, Landing + WorldMap ✅ pnpm verify green, 159 tests (29 new web: client 7, stores 8, routes 5, pages 7, terminal 2); live `pnpm dev`: guest→me→worlds round-trip + :5173 200
- [x] T4.2 Level page (terminal, quest panel, hints, reset, complete modal) ✅ pnpm verify green, 199 tests (40 new web: socket 8, session 10, terminal 4, panel 11, modal 2, page 5); live scripted WS solve of w1-02 via real SessionSocket → level_complete (A, 53 XP)
- [x] T4.3 Spellbook, Skills graph, Profile, Settings, MobileKeyBar, a11y ✅ pnpm verify green, 241 tests; Lighthouse a11y 100 Map + 100 Level (headless Chrome, live stack); D-014 additive API, D-015 tailwind fix

### M5 — Vertical slice (GATE — do not continue until green)

- [x] T5.1 Levels `w1-01`, `w1-02`, `w1-03` complete and passing `levels:test` ✅ levels:lint 3 levels 0 problems; levels:test --world 1 --seeds 3 green (27/27: baseline-fail/wrong-fail/reference-pass, w1-03 bonus reported)
- [x] T5.2 Playwright smoke test passes locally and in CI ✅ pnpm e2e green locally (Chromium 156, 5.5s spec); CI e2e job blocking with images + browser install

### M6 — Progression & polish

- [x] T6.1 Badges, streak, daily, review + UI surfaces ✅ pnpm verify green, 250 tests; test:docker 42 green; DailyCard + ReviewBanner on map; 25% review-replay XP (D-017)
- [x] T6.2 Tux dialogue system (intro, completion, idle nudge) ✅ pnpm verify green, 255 tests; test:docker 42 green (intro once incl. reconnect, success message, stale-socket fix)
- [x] T6.3 Telemetry events recorded for a full attempt ✅ pnpm verify green, 259 tests; test:docker 43 green (ordered 6-event trail over live w1-01); fixed concurrent-evaluation race found by the trail test

### M7 — Content: World 1 (12 levels) — see tables below

- [x] All W1 levels authored, linted, tested (3 seeds) ✅ levels:lint 12 levels 0 problems; levels:test --world 1 --seeds 3 green (baseline-fail/wrong-fail/reference-pass per level per seed); playability chain 01→12 over live sockets green; test:docker 57 green; pnpm verify 259 green; pnpm e2e green; W1 total 73 est. min ≤ 90

### M8 — Content: World 2 (15 levels) — **MVP release config** (`ENABLE_WORLDS=1,2`)

- [ ] All W2 levels authored, linted, tested (3 seeds)

### M9 — Hardening & deploy

- [ ] T9.1 Security checklist (`plan.md §13`) walked; waivers documented
- [ ] T9.2 Load test run; results recorded in `docs/loadtest.md`
- [ ] T9.3 `docs/deploy.md` verified end to end on a clean VM

### M10 — Worlds 3–5

- [ ] T10.1 `admin` profile (sudo allow-list, cron daemon, capability mapping)
- [ ] T10.2 Sidecars + `lan` networks (no egress verified)
- [ ] T10.3 SPIKE S1 cron timing — outcome logged in `DECISIONS.md`
- [ ] T10.4 SPIKE S2 systemd shim — outcome logged in `DECISIONS.md`
- [ ] T10.5 Author World 3, 4, 5 content
- [ ] T10.6 (Optional) OAuth / classroom mode

---

## Content tracker

Columns: **A** = authored (level.yaml, setup, solution, wrong, hints, explain) · **L** = `levels:lint` green · **T** = `levels:test` green (3 seeds)

### World 1 — The Lobby

| ID                        | A   | L   | T   |
| ------------------------- | --- | --- | --- |
| w1-01-first-words         | [x] | [x] | [x] |
| w1-02-where-am-i          | [x] | [x] | [x] |
| w1-03-moving-around       | [x] | [x] | [x] |
| w1-04-paths               | [x] | [x] | [x] |
| w1-05-peek-inside         | [x] | [x] | [x] |
| w1-06-make-things         | [x] | [x] | [x] |
| w1-07-copy-and-move       | [x] | [x] | [x] |
| w1-08-delete-carefully    | [x] | [x] | [x] |
| w1-09-reading-files       | [x] | [x] | [x] |
| w1-10-manual-labor        | [x] | [x] | [x] |
| w1-11-time-travel         | [x] | [x] | [x] |
| w1-12-boss-organize-chaos | [x] | [x] | [x] |

### World 2 — The Filing Room

| ID                         | A   | L   | T   |
| -------------------------- | --- | --- | --- |
| w2-01-wildcards            | [ ] | [ ] | [ ] |
| w2-02-brace-expansion      | [ ] | [ ] | [ ] |
| w2-03-find-by-name         | [ ] | [ ] | [ ] |
| w2-04-find-by-attrs        | [ ] | [ ] | [ ] |
| w2-05-grep-basics          | [ ] | [ ] | [ ] |
| w2-06-grep-recursive-regex | [ ] | [ ] | [ ] |
| w2-07-pipes                | [ ] | [ ] | [ ] |
| w2-08-redirection          | [ ] | [ ] | [ ] |
| w2-09-text-tools           | [ ] | [ ] | [ ] |
| w2-10-links-and-types      | [ ] | [ ] | [ ] |
| w2-11-permissions          | [ ] | [ ] | [ ] |
| w2-12-umask-recursive      | [ ] | [ ] | [ ] |
| w2-13-nano                 | [ ] | [ ] | [ ] |
| w2-14-vim-survival         | [ ] | [ ] | [ ] |
| w2-15-boss-log-detective   | [ ] | [ ] | [ ] |

### World 3 — The Engine Room

| ID                       | A   | L   | T   |
| ------------------------ | --- | --- | --- |
| w3-01-sudo-and-id        | [ ] | [ ] | [ ] |
| w3-02-users-groups       | [ ] | [ ] | [ ] |
| w3-03-chown-special-bits | [ ] | [ ] | [ ] |
| w3-04-ps-and-top         | [ ] | [ ] | [ ] |
| w3-05-signals-kill       | [ ] | [ ] | [ ] |
| w3-06-job-control        | [ ] | [ ] | [ ] |
| w3-07-environment        | [ ] | [ ] | [ ] |
| w3-08-disk-usage         | [ ] | [ ] | [ ] |
| w3-09-archives           | [ ] | [ ] | [ ] |
| w3-10-networking-basics  | [ ] | [ ] | [ ] |
| w3-11-curl-and-dns       | [ ] | [ ] | [ ] |
| w3-12-ssh-keys           | [ ] | [ ] | [ ] |
| w3-13-rsync              | [ ] | [ ] | [ ] |
| w3-14-packages           | [ ] | [ ] | [ ] |
| w3-15-boss-server-setup  | [ ] | [ ] | [ ] |

### World 4 — The Automation Lab

| ID                        | A   | L   | T   |
| ------------------------- | --- | --- | --- |
| w4-01-script-hello        | [ ] | [ ] | [ ] |
| w4-02-variables-quoting   | [ ] | [ ] | [ ] |
| w4-03-args-exit-codes     | [ ] | [ ] | [ ] |
| w4-04-conditionals        | [ ] | [ ] | [ ] |
| w4-05-loops               | [ ] | [ ] | [ ] |
| w4-06-functions           | [ ] | [ ] | [ ] |
| w4-07-strict-mode         | [ ] | [ ] | [ ] |
| w4-08-sed                 | [ ] | [ ] | [ ] |
| w4-09-awk                 | [ ] | [ ] | [ ] |
| w4-10-xargs-jq            | [ ] | [ ] | [ ] |
| w4-11-heredocs-diff       | [ ] | [ ] | [ ] |
| w4-12-cron-basics         | [ ] | [ ] | [ ] |
| w4-13-cron-pitfalls       | [ ] | [ ] | [ ] |
| w4-14-systemd-units       | [ ] | [ ] | [ ] |
| w4-15-logs-logrotate      | [ ] | [ ] | [ ] |
| w4-16-boss-nightly-backup | [ ] | [ ] | [ ] |

### World 5 — The War Room

| ID                                   | A   | L   | T   |
| ------------------------------------ | --- | --- | --- |
| w5-01-getopts-usage                  | [ ] | [ ] | [ ] |
| w5-02-idempotent-flock               | [ ] | [ ] | [ ] |
| w5-03-shellcheck-bats                | [ ] | [ ] | [ ] |
| w5-04-proc-strace-lsof               | [ ] | [ ] | [ ] |
| w5-05-perf-triage                    | [ ] | [ ] | [ ] |
| w5-06-network-debug                  | [ ] | [ ] | [ ] |
| w5-07-ssh-hardening                  | [ ] | [ ] | [ ] |
| w5-08-tmux-git-make                  | [ ] | [ ] | [ ] |
| w5-09-namespaces-optional (optional) | [ ] | [ ] | [ ] |
| w5-10-boss-prod-is-down              | [ ] | [ ] | [ ] |

---

## Audit remediation

Each branch records its own regression and verification evidence. The milestone checkboxes above remain tied to their original acceptance criteria.

- [x] A01 — concurrent starts/reset and global capacity; branch `codex/a01-session-concurrency`, commit `6871e9e`. ✅ `pnpm verify`: build/lint + 268 tests passed (9 new regressions); `pnpm test:docker`: 58 passed, including the full W1 socket progression chain. Gated tests reproduced same-user overlap, cross-user over-capacity, and reset/start overlap before the fix; verify release after failure, stale resets, and independent users.
- [x] A02 + A13 — invalidate closed/expiring sessions, serialize progress reset with launches/completion, and atomically credit an active attempt once; branch `codex/a02-completion-lifecycle` stacked on A01. ✅ `pnpm verify`: build/lint + 287 tests passed (19 new regressions on this branch, 28 across both branches); `pnpm test:docker`: 58 passed including the full W1 progression chain; `pnpm e2e`: Chromium smoke passed (10.3 s). Thirteen initial regressions failed before the fix. Covers abandon/reset/progress reset/shutdown, idle/max-age expiry during slow destruction, queued checks, late timeout after DB close, duplicate/retired/mismatched attempts, full rollback on late badge failure, and retry after persistence failure.
- [x] A03 — bound player streams, retained histories, exec output, socket traffic, and pending evaluations; branch `codex/a03-resource-bounds`, stacked on A02/A13. ✅ `pnpm verify`: build/lint + 318 tests passed (31 new unit regressions); `pnpm test:docker`: 60 passed (2 new regressions), including the full W1 socket progression chain; `pnpm e2e`: Chromium smoke passed (9.6 s). Seven initial history/queue regressions failed before the fix. Covers UTF-8 byte caps, newline-free/tiny-chunk streams, watcher byte/line rates, bounded command/answer evidence, combined stdout/stderr overflow, blocked PTY writes, slow socket buffers, fragmented/multibyte transport messages, message floods, reconnect budgets, single-rerun coalescing, and abandonment without XP on stream overflow. Split-byte watcher decoding also resolves A28 (D-024).
- [x] A04 — terminate and reap timed-out exec commands and descendants; branch `codex/a04-exec-termination`, stacked on A03. ✅ `pnpm verify`: build/lint + 327 tests passed (9 new unit regressions); `pnpm test:docker`: 70 passed (10 new regressions), including the full W1 socket progression chain; `pnpm e2e`: Chromium smoke passed (9.4 s). Four initial process-termination regressions and a finite-stdin compatibility regression failed before the fix. Covers repeated root/player timeouts, nested/double-forked/detached/TERM-ignoring and cross-UID descendants, absence from `/proc` including zombies, no delayed mutations, protected supervision, cleanup completion/failure, watchdog fallback, and preservation of intended services/argv/cwd/env/stdin/ordinary exit codes. Process checks exclude supervisor ancestors (D-025). Final Docker and browser suites ran sequentially because browser startup sweeps managed containers.
- [x] A05 — recover failed teardown and unwind complete launches; branch `codex/a05-teardown-recovery`, stacked on A04. ✅ `pnpm verify`: build/lint + 353 tests passed (26 new unit regressions); `pnpm test:docker`: 74 passed (4 new regressions), including the full W1 socket progression chain; `pnpm e2e`: Chromium smoke passed (7.9 s). Twenty initial regressions failed before the fix. Covers retained cleanup ownership/capacity, repeated periodic retry, shared destruction during overlapping closes/sweeps, expiry invalidation and notification once, failed orphan cleanup, failed container start/removal, setup/attempt/shell/watcher/event launch failures, late watcher acquisition after startup error/expiry, independent resource cleanup, abandoned/expired attempt status, original-error preservation, and shutdown retry. Real Docker tests assert containers disappear (404) after recovery. D-026 records semantics; A06 remains separate.
- [x] A06 — start periodic cleanup independently of boot orphan sweep failure; branch `codex/a06-reaper-startup`, based on main after A05. ✅ `pnpm verify`: build/lint + 360 tests passed (7 new Docker-free regressions); targeted reaper/session-manager suite: 23 passed; `pnpm test:docker`: 74 passed including full W1 progression; `pnpm e2e`: Chromium smoke passed (11.2 s). Five initial regressions failed before the fix. Covers failed boot listing, idle/max-age expiry after recovery, repeated orphan-discovery failures then removal, retained failed boot destruction/capacity recovery, expiry during pending discovery without overlapping listings, repeated starts, and shutdown after startup failure or during discovery. D-027 records retry semantics.
- [x] A07 — production server delivery; branch `codex/a07-production-delivery`, based on A06. ✅ `pnpm verify`: build/lint + 367 tests passed (7 new Docker-free delivery regressions); `pnpm test:docker`: 74 passed including full W1 progression; `pnpm e2e`: Chromium smoke passed (11.6 s). Two initial regressions reproduced root/asset 404s against the actual compiled entry point. Covers built HTML/JS/CSS/self-hosted font bytes and MIME, all client-route refreshes and HEAD, revalidation, API/health/error separation, real WebSocket upgrade/authorization, missing assets, traversal denial, non-GET requests, missing-build startup failure, and module-relative paths from an unrelated cwd. D-028 and `deploy.md` document delivery; A08 and clean-VM T9.3 remain separate.
- [x] A08 — production cookies, CSP, loopback proxy handling, and graceful shutdown; branch `codex/a08-production-hardening`, based on A07. ✅ `pnpm verify`: build/lint + 373 tests passed (6 new regressions); `pnpm test:docker`: 74 passed on retry, including full W1 progression; `pnpm e2e`: Chromium smoke passed (9.2 s). The compiled-server suite covers Secure cookie attributes, CSP on navigations, rate limits by the immediate client forwarded by Caddy, rejection of older hops and non-loopback forwarding, and SIGTERM/SIGINT with an active WebSocket and awaited stubbed sandbox teardown. D-029 records the deployment and Windows signal-test choices.

- [x] A09 — report newly unlocked levels on completion; branch `codex/a09-completion-unlocks`, based on A08. ✅ `pnpm verify`: build/lint + 373 tests passed. `pnpm e2e`: Chromium smoke passed (8.3 s). The new WebSocket assertion failed before the fix. The smoke now checks that completing w1-01 reports w1-02 in `result.unlocked`, shows the Next level button, and makes w1-02 available on the map. See D-030.
- [x] A10 — enforce `ENABLE_WORLDS` across level access, review, and unlocks; branch `codex/a10-world-availability`, based on A09. ✅ `pnpm verify`: build/lint + 381 tests passed (8 new regressions). Four API cases failed before the fix. Coverage includes detail and start with empty and partial allow-lists, reset with `UNLOCK_ALL`, historical review and boss prerequisites, and completion unlock payloads. See D-031.

- [x] A11 — restrict daily challenges to eligible, unlocked levels and count successful attempts on the selected UTC date. ✅ `pnpm verify`: build/lint + 384 tests passed. Four API regressions cover unlocks, default eligibility after world completion, disabled worlds, and matching player/level/status and UTC midnight boundaries. Three cases failed before the fix. See D-032.
- [x] A12 — save hint and command metrics on unfinished attempts. ✅ `pnpm verify`: build/lint + 386 tests passed. Regressions cover abandonment, reset, shutdown, both expiry paths, and Clean Sweep after hinted and hintless failed attempts. Six cases failed before the fix. See D-033.
- [x] A14 — report and handle session runtime failures and attribute check timeouts. ✅ `pnpm verify`: build/lint + 405 tests passed (19 new regressions); 24 targeted Docker tests passed. Coverage includes socket attachment, resize recovery, shell and watcher disconnects, exec transport failures, setup failure on start/reset, evaluation retry, and timeout attribution for file, negated, and script setup checks. See D-034.
- [x] A15 — close replaced WebSockets and give the latest authorized socket exclusive shell control. ✅ `pnpm verify`: build/lint + 407 tests passed. Regressions cover queued stale frames, replacement socket ownership after close, shared stdin and message budgets across reconnects, and no automatic reconnect on replacement. See D-035.
- [x] A16 — recover missed terminal output, issued hints, and committed completion results on reconnect. ✅ `pnpm verify`: build/lint + 416 tests passed (9 new regressions). Coverage includes startup output before shell subscription and terminal mount, cursor replay over a real WebSocket, byte and frame limits, duplicate suppression, modal recovery, and retry exhaustion despite brief opens. See D-036.

- [x] A17 — send a pending update when a hold objective stops passing. ✅ `pnpm verify`: build/lint + 417 tests passed. The regression reproduced the missing frame and now verifies that deleting and recreating the required file sends `done → pending → done` without repeating the pending update, then completes after the remaining objective passes.
- [x] A18 — attach stdin for non-PTY Docker execs when supplied and deliver EOF without closing the output stream. ✅ `pnpm verify`: build/lint + 417 tests passed; 24 targeted Docker tests passed. Three new cases cover empty input, nonempty UTF-8 input without a final newline, and input larger than Linux's argument size limit. The large case failed before the fix. See D-037.

- [x] A19 — match the exact local port and protocol in socket checks. ✅ `pnpm verify`: build/lint + 425 tests passed (8 new cases). Regressions cover neighboring and prefix ports, protocol mismatches, and peer-only matches. Six targeted Docker tests passed.
- [x] A20 — resolve script-test file globs and reads from the case scratch directory. ✅ `pnpm verify`: build/lint + 425 tests passed. Four targeted Docker tests passed, including the new relative-file regression that failed before the fix.
- [x] A21 — reconcile the XP breakdown with awarded XP and rank review replays using completed bonuses. ✅ `pnpm verify`: build/lint + 429 tests passed. Regressions cover hinted first clears and repeats, review ranks with no, completed, or missing bonus objectives, and deduction signs in the completion modal.
- [x] A22 — invalidate the Spellbook and Skills caches on level completion. ✅ `pnpm verify`: build/lint + 435 tests passed. Two navigation regressions reproduced the stale Spellbook with a cached or in-flight pre-clear response and now show the learned skill after returning through the map.
- [x] A23 — report the effective streak on user reads. ✅ `pnpm verify`: build/lint + 435 tests passed. The profile API regression checks the UTC midnight boundary after a missed day and verifies the stored streak is preserved.
- [x] A24 — schedule a hint nudge during inactivity. ✅ `pnpm verify`: build/lint + 435 tests passed. Fake-clock session tests verify the nudge fires once without more input and is canceled by objective progress or session teardown.
- [x] A25 — apply font size, high contrast, and reduced motion to the live terminal. ✅ `pnpm verify`: build/lint + 437 tests passed. The terminal regression covers initial preferences, updates to the same xterm instance, refit and resize notification, and subscription cleanup.
- [~] A26 — quest-panel controls keep focus out of xterm when activated. ✅ `pnpm verify`: panel regression covers mobile tabs, hint activation, and the Spellbook link. Completion-dialog focus and scrolling, keyboard-aware mobile keybar placement, and browser accessibility checks are still open.

## Known gaps

_Every stub, skipped test, simplification, or unfinished edge goes here. Nothing silent._

| Date       | Area                | Gap                                                                                     | Planned resolution                                         |
| ---------- | ------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| 2026-10-06 | skills.yaml prereqs | W1 skill edges authored in M7; W2+ skills still have empty `prereqs` | Author remaining edges during M8 |
| 2026-10-06 | cron daemon start   | `needs_cron` field present (default true); daemon start not implemented                 | Implement in T10.1 admin polish; no admin levels exist yet |
| 2026-10-11 | Web bundle size     | `dist` JS is ~576 KB (xterm.js); vite emits a chunk-size warning, no code-splitting yet | Consider `React.lazy` for `/play` during polish            |
| 2026-11-05 | Repository audit | 31 original prioritized findings. A01–A25 and A28 fixed with regressions (see Audit remediation above). A26 still needs modal focus and scrolling, mobile keybar placement, and browser accessibility checks. Remaining CI, validation, and documentation gaps are detailed in [PROJECT_AUDIT.md](PROJECT_AUDIT.md). | Resolve remaining findings alongside planned milestones and complete M9 production validation. |

## Blockers

_What is blocked, what was tried, what was done instead._

| Date | Task | Blocker | Tried | Workaround / next |
| ---- | ---- | ------- | ----- | ----------------- |
| —    | —    | —       | —     | —                 |

## Notes

- Documents that are templates until real work is done: `docs/loadtest.md` (needs an actual run, T9.2) and `docs/deploy.md` (needs verification on a clean VM, T9.3).
