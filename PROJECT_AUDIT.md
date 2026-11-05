# Terminal Quest — progress and correctness audit

Date: 2026-11-04 (America/Santiago). Reviewed commit: `7696019`.

The project has a working World 1 vertical slice and substantial completed infrastructure. It is **not ready for the planned MVP release**: World 2 is absent, deployment/hardening is unfinished, and the passing test suites miss several reproducible defects.

This audit changed no application code or milestone completion boxes. “Reproduced” below means a targeted local probe demonstrated the behavior. “Code review” means the finding follows from the implementation but was not exercised through a full browser/production deployment. This is a repository audit, not a penetration test or a certification that no other defects exist.

## Progress verified

| Area | Current status |
| --- | --- |
| M0–M3: scaffold, schemas, database, sandbox, engine, API/socket, persistence | Implemented; unit and Docker suites pass. Important edge cases below remain. |
| M4: browser UI | All main pages/components exist; browser smoke passes. Recovery, accessibility, and cache defects remain. |
| M5: vertical-slice gate | Passes locally now. Remote CI run history was not independently checked. |
| M6: progression, dialogue, telemetry | Implemented, with correctness gaps in daily challenges, hints, streak display, and nudges. |
| M7: World 1 | All 12 levels present; lint, three-seed content matrix, and live socket progression pass. |
| M8: World 2 | **0/15 levels authored. First unfinished milestone.** |
| M9: hardening/deployment | Security review, target-machine load test, and clean-VM deployment validation unfinished. |
| M10: Worlds 3–5 | Infrastructure and all 41 levels remain; OAuth/classroom is optional and later. |

There are **12/27 MVP levels** and **12/68 total planned levels**. These are content counts, not estimates of overall engineering completion. World 5 includes one optional level.

## Fresh verification results

| Check | Result |
| --- | --- |
| `pnpm verify` | PASS: build + ESLint/Prettier + **259 unit tests in 56 files** |
| `pnpm levels:lint` | PASS: **12 levels, 0 problems** |
| `pnpm test:docker` | PASS: **57 server integration tests + 1 level-runner integration test** |
| `pnpm levels:test --world 1 --seeds 3` | PASS: **12 levels × 3 seeds**, baseline fails, wrong solutions fail, references pass |
| `pnpm e2e` | PASS: **1 Chromium smoke test**, 8.9 seconds including startup |
| `pnpm levels:test --world 2 --seeds 3` | **Misleading success:** exits 0 with “no levels selected, nothing to do” |

Tests used the existing local `tq-base` image; the image was not rebuilt during this audit. Clean-VM deployment, rootless production behavior, 20-user performance, fresh Lighthouse scores, and remote CI results were not verified. The build still reports a **578.24 KB JavaScript chunk** warning. The unit suite emits a Tailwind content-configuration warning; the production build does generate CSS, so that warning alone does not establish broken production styling.

## P1 — fix before public deployment

Remediation is tracked separately from this dated audit snapshot:

| Finding | Status | Branch / evidence |
| --- | --- | --- |
| A01 | Fixed | `codex/a01-session-concurrency`, commit `6871e9e`; capacity reservations + per-user lifecycle queue; `pnpm verify` passes (268 tests, 9 new concurrency regressions); Docker suite 58 passed. |
| A02 | Fixed | `codex/a02-completion-lifecycle` (stacked on A01); immediate close invalidation, manager/registry ownership guards around async work, progress reset serialized with launch/completion. |
| A13 | Fixed | Same branch as A02: synchronous active-attempt transaction for attempt/progress/XP/streak/skills/badges, idempotent credit, rollback and retry. Final evidence for A02/A13: `pnpm verify` 287 tests (19 new on this branch); Docker 58 tests including W1 progression; Chromium smoke 1 passed (10.3 s). |

A03 is the next unresolved P1 finding. A03–A08 and the remaining P2/P3 findings are still open; the original reproduction notes below are retained as the audit snapshot. No World 2 content or production-hardening milestone was marked complete by these fixes.

### A01. Concurrent starts bypass both capacity and single-session limits — reproduced

Locations: `apps/server/src/sandbox/sessionManager.ts:56`, `apps/server/src/routes/sessions.ts:70`.

Capacity is checked before awaiting container creation, with no reservation. Per-user replacement also checks only already-registered sessions. A probe with `MAX_CONTAINERS=1` issued two simultaneous starts for one guest: **both returned 200; manager size and live-session count were both 2**. Serialize each user's start/reset flow and reserve global capacity before asynchronous work. Add overlapping-start/reset tests, not just sequential tests.

### A02. Abandoned/expired sessions can still complete and award XP — reproduced

Locations: `apps/server/src/ws/sessionFlow.ts:121`, `:384`; `apps/server/src/routes/progress.ts:302`.

Closing does not cancel or drain ongoing evaluations, and evaluation does not check that its session remains active before persisting. A paused check was released after abandonment: its attempt changed from **abandoned to completed**, awarded **55 XP**, and inserted progress. The same race threatens reset-progress semantics. Mark sessions closed immediately, cancel/ignore queued work, and synchronize lifecycle changes with completion persistence.

### A03. Player-controlled streams and evaluation queues are unbounded — code review plus configuration probe

Locations: `apps/server/src/sandbox/dockerProvider.ts:148`, `:300`; `apps/server/src/engine/objectiveTracker.ts:41`; `apps/server/src/ws/sessionFlow.ts:99`; `apps/server/src/ws/sessionSocket.ts:49`; `apps/server/src/app.ts:125`.

The stdin limiter does not bound writes a shell command generates to inbox/cmdlog. Lines without newlines grow `pending` indefinitely; answers/commands accumulate without bounds; every submit/check can enqueue another evaluation. Exec output is collected into unbounded arrays, and terminal sends have no backpressure policy. The WebSocket transport's actual `maxPayload` is **104,857,600 bytes**, while the schema checks only stdin string length after JSON parsing; it also measures characters rather than UTF-8 bytes. Bound bytes, line sizes, retained history, output buffers, message rates, and pending evaluations; coalesce checks and configure the transport limit explicitly. Validate inbox/log boundaries with shared schemas as required by AGENTS.md. No destructive flood was run.

### A04. Exec timeout does not terminate the command — reproduced in Docker

Location: `apps/server/src/sandbox/dockerProvider.ts:157`.

The timeout destroys the connection and resolves, leaving the process running until the container is eventually removed. A command with a 100 ms timeout was still visible to `pgrep` afterward. Timeouts therefore do not enforce the promised check execution bound, and repeated checks can accumulate processes. Enforce termination inside the container, including descendants, and test that the process actually disappears.

### A05. Failed teardown loses the container record; launch failures are incompletely unwound — partly reproduced

Locations: `apps/server/src/sandbox/sessionManager.ts:80`; `apps/server/src/sandbox/dockerProvider.ts:83`; `apps/server/src/ws/sessionFlow.ts:302`–`:375`.

The manager deletes a session **before** Docker destruction succeeds. A simulated destroy failure left manager size 0 and no retryable session, although destruction failed. Periodic sweeps do not rediscover such orphans. Container-start failures have no immediate removal path; watcher-start failures are outside the launch cleanup blocks; shell-start failure leaves an opened attempt unfinished. Retain/retry failed cleanup and unwind the whole launch operation, including watchers, shell, attempt status, and capacity reservation.

### A06. A failed boot orphan sweep prevents the periodic reaper from starting — code review

Locations: `apps/server/src/sandbox/reaper.ts:16`; `apps/server/src/app.ts:149`.

`Reaper.start()` awaits the boot sweep before installing its timer. `buildApp()` catches failure and continues, but never retries starting the reaper. If Docker recovers later, sessions can be created without idle/max-age cleanup. Install the timer independently of the boot sweep and test Docker being unavailable at startup and available afterward.

### A07. The documented production server cannot serve the game — reproduced

Locations: `apps/server/src/app.ts:65`; `apps/server/package.json`; `deploy.md:104`.

The server has neither static asset hosting nor SPA route fallback. `GET /` returns **404**. The documented Caddy configuration forwards everything to this server, so the published site would not load. Implement the planned built-web hosting/fallback or explicitly implement and document an alternative production topology, then exercise the actual production build.

### A08. Production cookie, CSP, proxy, and shutdown behavior is incomplete — code review plus response probes

Locations: `apps/server/src/auth.ts:52`; `apps/server/src/app.ts:65`; `apps/server/src/index.ts:8`; `deploy.md:133`–`:139`.

Cookies always have `secure: false`; responses have **no CSP**, despite the deployment guide claiming the server supplies one. Fastify does not trust the configured local reverse proxy, so the documented deployment groups client IP rate limits under the proxy's address. The entry point has no SIGTERM/SIGINT handler to invoke `app.close()`, so systemd stop/restart does not execute the existing graceful cleanup hook. Bind/configure exposure appropriately for the loopback deployment. Add production-aware secure cookies, CSP, narrowly trusted proxy handling, graceful shutdown, and tests using the production entry point and proxy configuration.

## P2 — functional and integrity defects

### A09. Completion reports no newly unlocked levels — reproduced

Locations: `apps/server/src/ws/sessionFlow.ts:76`, `:186`, `:210`; `apps/web/src/pages/LevelPage.tsx:126`.

`computeUnlocked()` reads the database **after** the current completion is saved, so its before/after sets already contain that level. Completing w1-01 produced `unlocked: []` instead of w1-02. The map refresh works, which is why the smoke test passes, but the completion modal has no Next Level action. Capture the prior state before persistence or compare against a prior set, and assert the completion payload and modal Next button.

### A10. `ENABLE_WORLDS` hides map cards but does not enforce API access — reproduced

Locations: `apps/server/src/routes/worlds.ts:22`; `apps/server/src/routes/levels.ts:6`; `apps/server/src/routes/sessions.ts:48`.

The level/detail/start paths do not check the world allow-list. With `ENABLE_WORLDS=[]`, starting w1-01 still returned **200**. Apply the same server-side availability policy to detail, start, reset/review where applicable, and unlock payloads; test direct requests to disabled content.

### A11. Daily challenges can be locked and completion is lifetime-based — reproduced

Location: `apps/server/src/routes/progress.ts:222`.

A new guest on 2026-11-04 was offered **w1-07-copy-and-move**, and starting it returned **403**. Selection ignores the specification's completed-world eligibility. The completed flag is merely `completions > 0`: a probe with a completion timestamp of 1 still marked today's challenge completed. Select from the intended eligible/unlocked pool and determine completion from a matching attempt on the selected UTC date.

### A12. Hints and command metrics disappear from unfinished attempts — reproduced for hints

Locations: `apps/server/src/ws/sessionFlow.ts:223`; `apps/server/src/progression/attempts.ts:56`; `apps/server/src/progression/badges.ts:83`.

Hint state is persisted only on successful completion. A hint followed by abandonment left **`hints_used=0`**. Reset/expiry/shutdown have the same omission; command counts/manual use are also left at defaults. Profile totals and the no-hints badge consequently use incomplete history. Persist metrics as used or at every terminal attempt transition, and define/test whether failed hinted attempts disqualify a no-hints world clear.

### A13. Completion writes are not atomic, and failures prevent retry — code review

Locations: `apps/server/src/progression/progress.ts:54`; `apps/server/src/ws/sessionFlow.ts:164`.

Attempt status, level progress, XP, skills, and badges are separate writes with no transaction. An exception can leave a partially credited completion. `live.completed` is set before these writes; a failure can then suppress retries while no result reaches the player. Use an atomic, idempotent completion operation and update in-memory completion only after successful persistence. Serialize reset-progress against this operation.

### A14. Important runtime errors are silently swallowed — code review

Locations: `apps/server/src/ws/sessionSocket.ts:109`; `apps/server/src/ws/sessionFlow.ts:353`, `:370`; `apps/server/src/sandbox/dockerProvider.ts:263`.

Socket/evaluation failures are caught with `() => undefined`. Docker resize promises have no rejection handler, and setup uses `request.log` although Fastify's logger is disabled. Replace silent catches with contextual pino logging (`attemptId`, `levelId`, `sessionId`), suitable client errors, and handled stream/shell/resize failures. Check-timeout telemetry currently covers only some check types (`engine/checks/context.ts:18`).

### A15. Replacing a socket leaves the previous socket able to send input — code review

Location: `apps/server/src/ws/sessionSocket.ts:95`.

A second attachment overwrites `live.socket` but neither closes the former connection nor invalidates its message handler. Both connections can still control the shell, while responses go to the latest connection. Each also has a separate stdin limiter. Close/invalidate old attachments and keep rate budgets with the session.

### A16. Reconnect state cannot recover missed results, hints, or terminal output — code review

Locations: `apps/server/src/ws/sessionFlow.ts:338`, `:411`; `apps/web/src/session/useSession.ts:152`; `apps/web/src/session/socket.ts:80`.

State replay includes only a completion boolean and hint count. If the connection misses `level_complete`, the client can become completed with no result/modal; missed hint text cannot be recovered. Output before socket attachment or while disconnected is discarded, including potentially the D-016 shell greeting. A connection that repeatedly opens and closes resets the retry counter on every open and can reconnect forever despite the three-attempt policy. Provide bounded replay/snapshots and define when a connection is stable enough to reset the retry budget.

### A17. `hold` objectives revert server-side without a pending frame — code review

Locations: `apps/server/src/engine/objectiveTracker.ts:121`; `apps/server/src/ws/sessionFlow.ts:139`.

The tracker sets a previously passing hold objective to false, but returns only newly-done transitions. The socket sends no `pending` transition, leaving the player's checkbox green while the server blocks completion. Emit both state transitions and test deleting/recreating a protected file before finishing the other objectives.

### A18. Non-PTY exec ignores provided stdin — reproduced in Docker

Location: `apps/server/src/sandbox/dockerProvider.ts:132`.

`container.exec()` never sets `AttachStdin`, although the later start/write path tries to supply stdin. Running `cat` with `stdin: 'audit-input\n'` returned **empty stdout with exit 0**. Set the exec attachment flag when stdin is supplied and test nonempty input and EOF. This affects the already-implemented `script_tests` feature needed by later worlds.

### A19. Port checks accept the wrong port or protocol — reproduced

Location: `apps/server/src/engine/checks/netExecChecks.ts:24`.

String matching `:80` also matches `:8080`, and UDP checks accept matching TCP rows. With an `ss` fixture containing only TCP 8080, **TCP 80 and UDP 8080 both passed**. Parse the protocol/local endpoint or use precise protocol-specific `ss` filters. Add neighboring-port and wrong-protocol negative cases.

### A20. Script-test file assertions do not use the case's scratch directory — code review

Location: `apps/server/src/engine/checks/scriptChecks.ts:94`.

The script/setup run with `cwd: scratch`; subsequent glob and file-read assertions omit that cwd. A schema-valid relative expected path can therefore be checked in a different directory. Use the same scratch cwd or resolve paths explicitly, and test a script creating a relative file.

### A21. Score presentation double-subtracts hints; review ranks cannot be S — reproduced

Locations: `apps/server/src/engine/scoring.ts:76`, `:93`; `apps/web/src/components/CompleteModal.tsx:45`.

For w1-01 with tier-1 hint, actual XP was **53**, while breakdown entries summed to **51**: base is already discounted and a separate negative hint line subtracts the penalty again. The modal also prefixes negative entries with `+`. Review scoring passes `allBonusDone=false` unconditionally, yielding **A** even for an otherwise S-rank no-bonus level. Make breakdown entries reconcile to awarded XP and calculate review rank from the actual bonus state (or document a deliberate alternative rule).

### A22. Spellbook cache stays stale after learning new skills — code review

Locations: `apps/web/src/stores/game.ts:79`; `apps/web/src/pages/LevelPage.tsx:61`; `apps/web/src/pages/SpellbookPage.tsx:77`.

The level page can cache an empty spellbook before the first clear. Completion refreshes profile/world/progress but does not invalidate/reload the spellbook. The spellbook page fetches only when its cache is null, so newly earned entries remain absent until a page reload. Invalidate or refresh learning caches after completion and test the complete-to-spellbook navigation flow.

### A23. Displayed streaks remain active after missed days — reproduced

Locations: `apps/server/src/auth.ts:62`; `apps/server/src/routes/me.ts:23`.

The next completion resets streak arithmetic correctly, but reads return the stored count unchanged. A user whose last active day was 2026-10-01 still received **7** on 2026-11-04. Return the current effective streak for today's UTC date and cover inactivity reads.

### A24. Idle nudges do not fire during actual inactivity — code review

Locations: `apps/server/src/progression/dialogue.ts:21`; `apps/server/src/ws/sessionFlow.ts:152`.

The time condition is checked only when evaluation runs. Three failures followed by three minutes of waiting cause no new evaluation and no nudge. Schedule a bounded session timer, cancel it on close/progress, and add a fake-clock integration test without subsequent player input.

### A25. Terminal accessibility settings do not reach xterm — code review

Location: `apps/web/src/components/TerminalView.tsx:47`.

The terminal has fixed theme colors, default pixel font size, and an always-blinking cursor; it does not subscribe to settings. Root CSS changes do not update those xterm options. Apply font size, high-contrast colors, and reduced-motion cursor policy to the live terminal and refit after changes.

### A26. Modal and panel focus/mobile behavior needs repair — code review

Locations: `apps/web/src/components/CompleteModal.tsx:14`; `apps/web/src/components/QuestPanel.tsx:63`; `apps/web/src/components/MobileKeyBar.tsx:56`.

The completion dialog has no initial focus management, focus containment/restoration, background inertness, or constrained scrolling; a long explanation can put its buttons off a short screen. The quest panel's bubbling click handler focuses xterm even when clicking interactive children. The mobile keybar is an ordinary flow element rather than positioned above the software keyboard as specified. Add keyboard/mobile regression coverage and re-run accessibility checks after these fixes.

### A27. CI omits the Docker integration suite and silently tolerates missing worlds — reproduced/code review

Locations: `.github/workflows/ci.yml:53`–`:56`; `tools/level-runner/src/main.ts:91`–`:105`; `e2e/smoke.spec.ts:5`.

No CI job invokes `pnpm test:docker`; level solutions and one browser smoke do not exercise its 58 tests. `--world 2` currently exits **0 with no tests**, and `--world 1,2` silently tests only World 1. Make explicitly requested missing worlds fail, enforce expected release content counts, and run the Docker suite in CI. Extend regression coverage to the defects above, especially concurrency, Next Level, recovery, and reset races. The smoke readiness gate checks status 200 rather than `docker: true`, despite its comment claiming Docker readiness.

### A28. File-watch UTF-8 decoding can corrupt split characters — code review

Location: `apps/server/src/sandbox/dockerProvider.ts:302`.

`openShell()` correctly uses `StringDecoder`; `watchFile()` decodes each chunk independently. A multibyte command/answer split between chunks becomes replacement characters and may fail checks. Use a persistent decoder for watched streams and add a split-byte test.

## P3 — validation, maintainability, and documentation

### A29. Configuration/content validation does not enforce the full authoring contract — code review

Locations: `apps/server/src/config.ts:14`; `apps/server/src/engine/levelLoader.ts:66`; `tools/level-runner/src/lint.ts:88`; `packages/shared/src/level.ts:178`.

`ENABLE_WORLDS` silently drops invalid tokens and accepts numbers above 5. `SANDBOX_RUNTIME` is read directly outside config validation and the advertised `SANDBOX_IMAGE` override is not wired. The loader silently overwrites duplicate skill IDs; regex/prerequisite errors are not fully validated. Schema/lint allow empty explain/cheatsheet lists and no wrong solutions for ordinary levels; bosses require only one wrong solution, whereas AGENTS.md requires two. Strengthen these guards before authoring the remaining content. The lint rule for seeded inline files is overbroad: it rejects all inline text, rather than specifically leaked answers, and does not inspect answer-bearing `content_file` content.

### A30. Remaining UI/performance/health polish — code review and build evidence

Locations: `apps/web/src/strings.ts:43`; `apps/web/src/components/HintPanel.tsx:42`; `apps/web/src/components/Toasts.tsx:31`; `apps/server/src/routes/health.ts:8`; `apps/web/src/routes/routes.tsx:1`.

The hint button always advertises a 5% penalty even when the next tier costs 10% or 25%. Several UI strings still bypass `strings.ts`. The eagerly imported xterm bundle produces the measured 578.24 KB chunk warning; lazy-loading the play route is the existing planned remedy. Health probes construct Docker connection options differently from `DockerProvider`, so the default Unix socket can falsely report Docker unavailable on Windows while gameplay works. Unify connection handling and separate readiness from liveness if deployment uses them differently.

### A31. Progress/deployment documentation is stale or inconsistent — verified from repository

Locations: `PROGRESS.md:7`; root `deploy.md`; root `loadtest.md`; `plan.md:828`.

The current-focus banner still says **M6/T6.1**, although M6 and M7 are checked complete; it should identify M8 as the next milestone. References point to `docs/deploy.md` and `docs/loadtest.md`, but the files are in the repository root and `docs/` does not exist. The deploy guide claims static serving, CSP, sidecar builds, and graceful restart messages that are not currently implemented. It also migrates the default DB before introducing the service's different `DB_PATH`, without showing the migration against that production path. Correct the guide and verify it on a clean VM; its draft status is accurate and must remain until then.

## Work still required by the plan

1. **M8:** author all 15 World 2 levels, including generators where needed, setup/checks, exactly three hints, explain/cheatsheet content, reference/wrong scripts, and three-seed evidence. Complete remaining skill prerequisite edges.
2. **T9.1:** finish the security checklist after A01–A08 and related boundary fixes; record explicit waivers where applicable. Verify rootless Docker and resource limits in the actual target environment.
3. **T9.2:** implement/run the load test on the target 4-vCPU/8-GB environment: 20 sessions, 21st rejected, latency/resource measurements, stable cleanup, idle expiry, and restart/orphan recovery. Populate the report with measured data.
4. **T9.3:** implement production serving/configuration, correct the deployment instructions, and validate install/migration/service/proxy/backups/restore/upgrades on a fresh VM.
5. **M10 infrastructure:** restricted admin sudo configuration, cron startup, declared capability mapping, sidecars, per-attempt internal LANs with no egress, cron timing spike/fallback, and disclosed systemd shim.
6. **M10 content:** World 3: 15 levels; World 4: 16; World 5: 10 including its optional level. Keep OAuth/classroom work after these unless the product plan changes.

Suggested order: fix lifecycle/resource/integrity issues and add regressions first; fix progression/recovery/UI bugs next; complete World 2; then prove production hardening, load, and deployment. Keep the passing World 1 matrix and browser gate throughout. This audit does not revoke the demonstrated World 1 progress, but green tests alone do not establish the correctness of untested edge cases.
