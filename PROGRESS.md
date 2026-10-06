# PROGRESS.md

Single source of truth for build status. Tick a box only when the task's acceptance criteria in `plan.md §15` are demonstrably met, and add a short evidence note (e.g. `pnpm verify green, 14 tests`).

**Legend:** `[ ]` not started · `[~]` in progress · `[x]` done · `[!]` blocked (see Blockers)

**Current focus:** M1 → T1.2 (T1.1 done)

---

## Milestones

### M0 — Scaffold
- [x] T0.1 Monorepo, tooling, empty skeletons build; `/healthz` works ✅ pnpm verify green, 3 tests; /healthz live {ok:true,docker:false}; web :5173 200 (Node 24 / pnpm 9.15.9)
- [x] T0.2 `packages/shared` zod schemas (protocol, level, checks) + tests ✅ pnpm verify green, 35 tests (34 shared: checks 17, level 7, protocol 6, api 4)
- [x] T0.3 DB schema + migrations + client ✅ pnpm verify green, 38 tests; pnpm db:migrate creates all 8 tables (verified on scratch DB)
- [x] T0.4 CI workflow (`verify`, `levels`, `e2e` jobs) ✅ actionlint 1.7.7 clean, verify job defined; pnpm verify green, 38 tests

### M1 — Sandbox
- [x] T1.1 `tq-base` image + `/opt/tq` helpers (`bashrc`, `tux`, cheats) ✅ images:build ok; whoami=player, bin={tux,tldr,modeof.sh}; sudo/su denied, /opt/tq ro, secret 700; tux submit JSON ok
- [ ] T1.2 `DockerProvider` + security profiles (+ `test:docker` script)
- [ ] T1.3 `SessionManager` + reaper (idle, max-age, orphan sweep, capacity)

### M2 — Level engine
- [ ] T2.1 `levelLoader` + `levels:lint`
- [ ] T2.2 `setupCompiler` + seeded generators run in sandbox
- [ ] T2.3 Core check types (file/process/port/answer/cwd/command/combinators/exec)
- [ ] T2.4 `ObjectiveTracker`, cmdlog parser, tux inbox, scoring, hints, coach
- [ ] T2.5 `script_tests`, `crontab_entry`, `cron_dry_run`, `login_shell_eval`, `cronmatch.py`
- [ ] T2.6 `tools/level-runner` (`levels:test`)

### M3 — Server API & socket
- [ ] T3.1 Guest auth, `me`, `worlds`, `levels/:id` public DTO, unlock logic
- [ ] T3.2 `start` / `reset` / `DELETE session` + WebSocket wiring
- [ ] T3.3 Persistence: attempts, progress, skills, XP, badges, streaks, spellbook, daily, review

### M4 — Web client
- [ ] T4.1 Theme, routing, API client, stores, Landing + WorldMap
- [ ] T4.2 Level page (terminal, quest panel, hints, reset, complete modal)
- [ ] T4.3 Spellbook, Skills graph, Profile, Settings, MobileKeyBar, a11y

### M5 — Vertical slice (GATE — do not continue until green)
- [ ] T5.1 Levels `w1-01`, `w1-02`, `w1-03` complete and passing `levels:test`
- [ ] T5.2 Playwright smoke test passes locally and in CI

### M6 — Progression & polish
- [ ] T6.1 Badges, streak, daily, review + UI surfaces
- [ ] T6.2 Tux dialogue system (intro, completion, idle nudge)
- [ ] T6.3 Telemetry events recorded for a full attempt

### M7 — Content: World 1 (12 levels) — see tables below
- [ ] All W1 levels authored, linted, tested (3 seeds)

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
| ID | A | L | T |
|---|---|---|---|
| w1-01-first-words | [ ] | [ ] | [ ] |
| w1-02-where-am-i | [ ] | [ ] | [ ] |
| w1-03-moving-around | [ ] | [ ] | [ ] |
| w1-04-paths | [ ] | [ ] | [ ] |
| w1-05-peek-inside | [ ] | [ ] | [ ] |
| w1-06-make-things | [ ] | [ ] | [ ] |
| w1-07-copy-and-move | [ ] | [ ] | [ ] |
| w1-08-delete-carefully | [ ] | [ ] | [ ] |
| w1-09-reading-files | [ ] | [ ] | [ ] |
| w1-10-manual-labor | [ ] | [ ] | [ ] |
| w1-11-time-travel | [ ] | [ ] | [ ] |
| w1-12-boss-organize-chaos | [ ] | [ ] | [ ] |

### World 2 — The Filing Room
| ID | A | L | T |
|---|---|---|---|
| w2-01-wildcards | [ ] | [ ] | [ ] |
| w2-02-brace-expansion | [ ] | [ ] | [ ] |
| w2-03-find-by-name | [ ] | [ ] | [ ] |
| w2-04-find-by-attrs | [ ] | [ ] | [ ] |
| w2-05-grep-basics | [ ] | [ ] | [ ] |
| w2-06-grep-recursive-regex | [ ] | [ ] | [ ] |
| w2-07-pipes | [ ] | [ ] | [ ] |
| w2-08-redirection | [ ] | [ ] | [ ] |
| w2-09-text-tools | [ ] | [ ] | [ ] |
| w2-10-links-and-types | [ ] | [ ] | [ ] |
| w2-11-permissions | [ ] | [ ] | [ ] |
| w2-12-umask-recursive | [ ] | [ ] | [ ] |
| w2-13-nano | [ ] | [ ] | [ ] |
| w2-14-vim-survival | [ ] | [ ] | [ ] |
| w2-15-boss-log-detective | [ ] | [ ] | [ ] |

### World 3 — The Engine Room
| ID | A | L | T |
|---|---|---|---|
| w3-01-sudo-and-id | [ ] | [ ] | [ ] |
| w3-02-users-groups | [ ] | [ ] | [ ] |
| w3-03-chown-special-bits | [ ] | [ ] | [ ] |
| w3-04-ps-and-top | [ ] | [ ] | [ ] |
| w3-05-signals-kill | [ ] | [ ] | [ ] |
| w3-06-job-control | [ ] | [ ] | [ ] |
| w3-07-environment | [ ] | [ ] | [ ] |
| w3-08-disk-usage | [ ] | [ ] | [ ] |
| w3-09-archives | [ ] | [ ] | [ ] |
| w3-10-networking-basics | [ ] | [ ] | [ ] |
| w3-11-curl-and-dns | [ ] | [ ] | [ ] |
| w3-12-ssh-keys | [ ] | [ ] | [ ] |
| w3-13-rsync | [ ] | [ ] | [ ] |
| w3-14-packages | [ ] | [ ] | [ ] |
| w3-15-boss-server-setup | [ ] | [ ] | [ ] |

### World 4 — The Automation Lab
| ID | A | L | T |
|---|---|---|---|
| w4-01-script-hello | [ ] | [ ] | [ ] |
| w4-02-variables-quoting | [ ] | [ ] | [ ] |
| w4-03-args-exit-codes | [ ] | [ ] | [ ] |
| w4-04-conditionals | [ ] | [ ] | [ ] |
| w4-05-loops | [ ] | [ ] | [ ] |
| w4-06-functions | [ ] | [ ] | [ ] |
| w4-07-strict-mode | [ ] | [ ] | [ ] |
| w4-08-sed | [ ] | [ ] | [ ] |
| w4-09-awk | [ ] | [ ] | [ ] |
| w4-10-xargs-jq | [ ] | [ ] | [ ] |
| w4-11-heredocs-diff | [ ] | [ ] | [ ] |
| w4-12-cron-basics | [ ] | [ ] | [ ] |
| w4-13-cron-pitfalls | [ ] | [ ] | [ ] |
| w4-14-systemd-units | [ ] | [ ] | [ ] |
| w4-15-logs-logrotate | [ ] | [ ] | [ ] |
| w4-16-boss-nightly-backup | [ ] | [ ] | [ ] |

### World 5 — The War Room
| ID | A | L | T |
|---|---|---|---|
| w5-01-getopts-usage | [ ] | [ ] | [ ] |
| w5-02-idempotent-flock | [ ] | [ ] | [ ] |
| w5-03-shellcheck-bats | [ ] | [ ] | [ ] |
| w5-04-proc-strace-lsof | [ ] | [ ] | [ ] |
| w5-05-perf-triage | [ ] | [ ] | [ ] |
| w5-06-network-debug | [ ] | [ ] | [ ] |
| w5-07-ssh-hardening | [ ] | [ ] | [ ] |
| w5-08-tmux-git-make | [ ] | [ ] | [ ] |
| w5-09-namespaces-optional (optional) | [ ] | [ ] | [ ] |
| w5-10-boss-prod-is-down | [ ] | [ ] | [ ] |

---

## Known gaps
_Every stub, skipped test, simplification, or unfinished edge goes here. Nothing silent._

| Date | Area | Gap | Planned resolution |
|---|---|---|---|
| 2026-10-06 | CI `levels` job | Non-blocking (`continue-on-error`) until `levels:lint`/`levels:test` exist | Make blocking in T2.6, remove TODO in `ci.yml` |
| 2026-10-06 | CI `e2e` job | Non-blocking (`continue-on-error`) until Playwright smoke test exists | Make blocking in T5.2, remove TODO in `ci.yml` |
| 2026-10-06 | `tq-base` checkers | `cronmatch.py` + other check-specific helpers not baked (only tux/tldr/modeof.sh) | Add with their check types in T2.3/T2.5 |

## Blockers
_What is blocked, what was tried, what was done instead._

| Date | Task | Blocker | Tried | Workaround / next |
|---|---|---|---|---|
| — | — | — | — | — |

## Notes
- Documents that are templates until real work is done: `docs/loadtest.md` (needs an actual run, T9.2) and `docs/deploy.md` (needs verification on a clean VM, T9.3).
