# AGENTS.md — Terminal Quest

Instructions for AI coding agents (opencode, Claude Code, Codex, etc.) working in this repository. Humans can read it too.

## 1. What this project is

Terminal Quest is a browser game that teaches the Linux command line. Players type real commands into a real, sandboxed Linux shell (Docker container per attempt) and complete story missions. Success is verified by inspecting system state, not by matching exact commands.

**`plan.md` is the source of truth** for architecture, schemas, APIs, curriculum, and milestones. This file tells you *how to work*; `plan.md` tells you *what to build*. If they conflict, `plan.md` wins, and you record the conflict in `DECISIONS.md`.

## 2. Before you start any session

1. Read `PROGRESS.md` to find the first unticked task. Work on that task only.
2. Read the matching milestone and any sections it references in `plan.md`.
3. Skim `DECISIONS.md` so you don't reverse earlier decisions without reason.
4. Run `pnpm verify` to confirm the repo is green before you change anything. If it is red, fix that first (or log why you can't).

## 3. Commands

```bash
pnpm i                        # install
pnpm dev                      # server (tsx watch) + web (vite)
pnpm build                    # build shared, server, web
pnpm lint                     # eslint + prettier --check
pnpm test                     # vitest (no Docker required)
pnpm verify                   # build && lint && test  ← run before every commit
pnpm images:build             # build sandbox images (requires Docker)
pnpm db:migrate               # apply drizzle migrations
pnpm levels:lint              # validate all level.yaml files (fast, no Docker)
pnpm levels:test              # run level solutions in Docker; flags: --level <id> --world <n> --seeds 3
pnpm e2e                      # Playwright smoke test
```
Integration tests that need Docker are tagged `*.docker.test.ts` and run via `pnpm test:docker` (add this script in T1.2). Plain `pnpm test` must pass on a machine without Docker.

## 4. Repository map

```
apps/server            Fastify API + WebSocket + sandbox manager + level engine
apps/web               React + Vite client (xterm.js terminal)
packages/shared        zod schemas & types shared by server and web (protocol, level, checks, api)
packages/levels        ALL game content: skills.yaml, badges.yaml, coach.yaml, content/w<N>/<NN>-<slug>/
packages/sandbox-images Dockerfiles for tq-base and sidecars (web, ssh, dns)
tools/level-runner     CLI behind `levels:lint` and `levels:test`
docs/                  deploy.md, loadtest.md
```

## 5. Coding conventions

- TypeScript `strict: true`. No `any` without a comment explaining why. Prefer `unknown` + zod parsing at boundaries.
- Validate **every** external input (HTTP body, WebSocket frame, YAML, env) with zod from `packages/shared`.
- One responsibility per module; keep files under ~300 lines. Split before they grow.
- No default exports except React pages/components where the router needs them.
- Errors: throw typed errors in the engine; convert to HTTP/WS errors at the edge only. Never swallow errors silently; log with `logger` (pino) and context (`attemptId`, `levelId`).
- UI strings live in `apps/web/src/strings.ts` (future i18n). No hard-coded English in components.
- Server code never imports from `apps/web`; web never imports from `apps/server`. Share via `packages/shared`.
- Tests live beside code (`*.test.ts`). Every new check type, scoring rule, or API route gets tests.
- Commit messages: Conventional Commits (`feat(engine): add file_mode check`). One task ≈ one or a few commits.

## 6. Hard rules (do not violate)

1. **Never leak answers.** `GET /api/levels/:id` returns an explicit whitelisted public DTO (`toPublicLevel`). Checks, setup, secrets, solutions, and hint text never go to the client except hints via the WebSocket when requested.
2. **Never run player input on the host.** All shell activity happens in sandbox containers only. Never mount host directories into sandboxes. Never mount or expose the Docker socket inside a sandbox.
3. **Sandbox defaults are restrictive:** `--cap-drop ALL`, resource limits, `--network none` unless the level declares `lan`, `no-new-privileges` for `basic` profile. Loosen only per the profile table in `plan.md §7.3`.
4. **Checks run as root with a fixed environment** (`env -i PATH=/usr/bin:/bin:/opt/tq/bin HOME=/root`) and a 5 s timeout. Check scripts must be read-only with respect to the sandbox state and idempotent.
5. **Server is authoritative** for objective state, hints, and score. The client only renders.
6. **No placeholder levels.** A level is only "done" when it has setup, checks, three hints, explain cards, a reference solution, and passes `levels:test` for 3 seeds (baseline fails, wrong solutions fail, reference passes).
7. **No secrets or answers in plaintext in `setup.files` for seeded levels.** Generators write answers to `/opt/tq/secret/*`.
8. **Do not add external network dependencies at runtime** (no CDNs, no analytics SaaS). Fonts are self-hosted via `@fontsource`.
9. **Do not weaken security or tests to make something pass.** If a check is flaky, fix the level or the check.
10. **Do not edit `plan.md` silently.** If the plan needs changing, record it in `DECISIONS.md` and, if substantive, append a dated note at the top of the relevant `plan.md` section.

## 7. Working protocol

- **Make decisions, don't ask.** When ambiguous, choose the simplest option that satisfies the task's acceptance criteria and log it in `DECISIONS.md` (ID, date, context, decision, consequences, status).
- **Vertical slice first (M5 gate).** Don't author breadth content until the e2e smoke test (`pnpm e2e`) passes for `w1-01`.
- **Update `PROGRESS.md`** only when a task's acceptance criteria are *demonstrably* met (command output, test name). Add a short evidence note next to the tick (e.g. `✅ pnpm verify green, 14 tests`).
- **Known gaps go in `PROGRESS.md` → "Known gaps".** Never leave a silent stub, TODO, or `it.skip` without an entry.
- **Spikes (S1 cron timing, S2 systemd):** timebox to one focused attempt. If it doesn't work, switch to the documented fallback in `plan.md §15 T10.3/T10.4` and record the outcome.
- **If you are blocked** (missing Docker, failing environment, contradictory requirement): log it in `PROGRESS.md → Blockers` with what you tried, then move to the next task that doesn't depend on it.
- **Keep changes reviewable:** no drive-by refactors; no mass-formatting unrelated files.

## 8. Authoring a level (checklist)

1. Pick the row in `plan.md §11.3`; use ID `w<N>-<NN>-<slug>`; create `packages/levels/content/w<N>/<NN>-<slug>/`.
2. Write `level.yaml` per `plan.md §8.1`; story ≤ 80 words in Tux-9000's voice (`plan.md §16.1`).
3. Seed anything lookup-able with `setup/gen.sh` using `RANDOM=$TQ_SEED`; write answers to `/opt/tq/secret/<name>` (mode 600).
4. Prefer outcome checks (`file_content`, `file_mode`, `answer_equals`, `exec`) over `command_used`. `command_used` is for teaching beats and bonus objectives.
5. Write `solution.sh` that *derives* answers from visible data (it must prove a player can solve the level).
6. Write at least one `wrong/*.sh` (bosses: ≥2) representing a natural mistake.
7. Add exactly 3 hints (nudge → command/flag → near-solution), `explain` cards, `cheatsheet` entries, `success_message`.
8. Run `pnpm levels:lint`, then `pnpm levels:test --level <id> --seeds 3`.
9. Tick the level in `PROGRESS.md` (columns: authored / lint / test).

## 9. Gotchas worth remembering

- The player's shell logs each finished command to `/run/tq/cmdlog` as `epoch<TAB>exit<TAB>cwd<TAB>command`. Empty Enter must not duplicate entries (dedupe via history number).
- Shell cwd for `shell_cwd` check: `/usr/sbin/runuser -u player -- readlink /proc/$(pgrep -o -u player -x bash)/cwd` (oldest `bash` of `player` is the interactive shell; runuser because root in the `basic` profile lacks CAP_SYS_PTRACE for cross-UID /proc reads — see D-013).
- `tux submit` writes a JSON line to `/run/tq/inbox`; the server watches it with a long-lived `docker exec tail -F`. Always JSON-escape with `jq -n --arg`.
- We do **not** capture stderr/stdout of player commands (it's a raw PTY). Error coaching is based on exit code + command text only.
- Multi-byte UTF-8 can split across Docker stream chunks — use `StringDecoder`.
- `no-new-privileges` breaks `sudo`; only use it in the `basic` profile.
- Debian cron has a minimal environment; that's the point of the cron-pitfalls level, don't "fix" it.
- Reset creates a **new seed**; never reuse the old one.
- Real systemd is not available in sandboxes; the `systemctl` shim (T10.4) is intentional and must be disclosed to the player on the level page.

## 10. Definition of done (per task)

- [ ] Acceptance criteria in `plan.md §15` for the task are met and evidenced
- [ ] `pnpm verify` passes
- [ ] New logic has tests; new levels pass `levels:test` (3 seeds)
- [ ] No new `any`, skipped tests, or untracked TODOs
- [ ] `PROGRESS.md` and (if applicable) `DECISIONS.md` updated
- [ ] Conventional commit(s) made

## 11. Where to look when stuck

| Question | Look at |
|---|---|
| What does this API/WS message look like? | `plan.md §6`, `packages/shared/src/{api,protocol}.ts` |
| How do I write a check/level? | `plan.md §8`, §16.3 worked example |
| What are the sandbox security flags? | `plan.md §7.3`, §13 |
| How is XP/rank computed? | `plan.md §10`, `apps/server/src/engine/scoring.ts` |
| What content is needed next? | `plan.md §11.3`, `PROGRESS.md` content tables |
| How do I deploy? | `docs/deploy.md` |
