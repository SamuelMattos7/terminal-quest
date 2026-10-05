# Terminal Quest — Build Specification

> A game that teaches the Linux command line, from "what is a terminal?" to writing production scripts, cron jobs, and debugging a server on fire.
> **Audience for this document: an autonomous coding agent.** It is written to be executed top to bottom. Decisions are already made; follow them.

---

## 0. How to Use This Document (Agent Instructions)

### 0.1 Operating rules
0. **Read `AGENTS.md` first** (how to work: commands, conventions, hard rules). `PROGRESS.md` and `DECISIONS.md` already exist in the repo root; update them as you go rather than recreating them. `docs/deploy.md` and `docs/loadtest.md` exist as a draft and a template; T9.3 and T9.2 finish them.
1. **Read the whole document first**, then start at Milestone M0 (§15) and proceed in order. Do not skip ahead.
2. **Vertical slice first.** Get ONE level playable end-to-end (browser → terminal → sandbox → validation → completion screen) before building breadth (M5). Everything before M5 exists to support that slice.
3. **Make decisions, don't ask.** If something is ambiguous, pick the simplest option that satisfies the acceptance criteria, and record it in `DECISIONS.md` (one short entry: context, decision, reason).
4. **Keep `PROGRESS.md`** at the repo root: a checklist copied from §15, ticked as tasks pass their acceptance criteria. Also list known gaps and stubs there. Never leave a silent stub.
5. **Definition of done for any task:** code compiles (`pnpm build`), lint passes (`pnpm lint`), tests pass (`pnpm test`), and the task's acceptance criteria in §15 are demonstrably met. Run `pnpm verify` (runs all three) before ticking a task.
6. **Commit after each task** with a conventional-commit message (`feat(server): ...`).
7. **Never run destructive commands on the host.** All player-typed commands run only inside sandbox containers. Do not mount host paths into sandboxes other than read-only helper files described in §7.
8. **No placeholder content in shipped levels.** Every level listed as in-scope for a milestone must have working setup, checks, hints, and a passing reference solution test (§12).
9. **Security-sensitive code (§13) must follow the checklist exactly.** When unsure, be more restrictive.
10. If a spike (marked **SPIKE**) fails, use the stated fallback and note it in `DECISIONS.md`.

### 0.2 Glossary
- **Level**: one mission with story, setup, objectives, hints. Defined in YAML (§8).
- **World**: an ordered group of levels (1–5).
- **Objective**: a single verifiable goal inside a level.
- **Check**: the machine-verifiable condition behind an objective.
- **Sandbox**: a Docker container (plus optional sidecars) created per attempt.
- **Attempt**: one play session of one level by one user.
- **Tux-9000**: the in-game mentor character.
- **Skill**: a command or concept node (e.g. `grep`, `redirection`, `cron`).

---

## 1. Product Summary

**Pitch:** Learn Linux by actually using it. Players type real commands in a real (sandboxed) Linux shell, in a browser, to complete story missions. Outcomes are verified by inspecting system state, not by matching exact commands.

**Players:** total beginners → senior engineers (see tiers in §11).

**Core loop:** read mission → type commands in terminal → objectives tick off live → level complete screen (XP, rank, "what just happened" breakdown) → unlock next level.

### 1.1 In scope (MVP = Worlds 1–2 fully; Worlds 3–5 as later milestones)
- Web app with embedded terminal (xterm.js) connected to a per-attempt Docker sandbox.
- Level engine: YAML levels, setup, live validation, hints, command logging, reset.
- Progression: XP, ranks, player levels, skill tree, spellbook (cheat sheet), badges, streaks.
- Guest accounts (cookie) with progress saved server-side.
- ~65 levels across 5 worlds (§11).

### 1.2 Non-goals for MVP
- Competitive leaderboards (anti-cheat is best-effort only).
- Native mobile apps (web must be usable on mobile for reading/review; see §9.6).
- Multiplayer, level editor UI, payments, i18n (design strings for later i18n: keep UI text in one `strings.ts`).
- WebAssembly in-browser Linux (the `SandboxProvider` interface in §7.2 keeps this possible later).

---

## 2. Locked Technology Decisions

| Concern | Decision |
|---|---|
| Language | TypeScript (strict), Node.js 22 LTS |
| Package manager / monorepo | pnpm workspaces |
| Frontend | React 18 + Vite + TypeScript, React Router 6, Zustand (state), Tailwind CSS |
| Terminal widget | `@xterm/xterm` + `@xterm/addon-fit` + `@xterm/addon-web-links` |
| Backend | Fastify 5, `@fastify/websocket`, `@fastify/cookie`, `@fastify/rate-limit`, `@fastify/static`, `zod` |
| Docker control | `dockerode` (Docker Engine API over unix socket) |
| DB | SQLite via `better-sqlite3` + `drizzle-orm` + `drizzle-kit` migrations (portable to Postgres later) |
| Level content | YAML files validated by zod; loaded at server start |
| Testing | `vitest` (unit/integration), `playwright` (e2e smoke) |
| Lint/format | ESLint (typescript-eslint), Prettier |
| Fonts | `@fontsource/jetbrains-mono`, `@fontsource/inter` (self-hosted, no external CDNs) |
| Sandbox base image | Debian 12 (bookworm-slim) → image `tq-base` |
| CI | GitHub Actions (build, lint, unit, level-solution tests with Docker, e2e) |

**Why Docker-first rather than in-browser WASM:** later worlds need real cron, sshd, process tools, and networking. One architecture for all worlds is less work for an agent to get right. WASM is explicitly deferred.

---

## 3. Repository Layout

```
terminal-quest/
├─ package.json                 # root scripts (see §3.1)
├─ pnpm-workspace.yaml
├─ tsconfig.base.json
├─ AGENTS.md                    # working instructions for coding agents (read first)
├─ PROGRESS.md                  # build status checklist (milestones + per-level tracker)
├─ DECISIONS.md                 # decision log (pre-seeded D-001..D-010)
├─ docs/
│  ├─ deploy.md                 # draft deploy guide; verified in T9.3
│  └─ loadtest.md               # template; filled in by T9.2
├─ docker-compose.yml           # dev helpers (sidecars, optional); see §14
├─ .github/workflows/ci.yml
├─ apps/
│  ├─ server/
│  │  ├─ src/
│  │  │  ├─ index.ts            # bootstrap
│  │  │  ├─ config.ts           # env parsing (zod)
│  │  │  ├─ db/{schema.ts,client.ts,migrations/}
│  │  │  ├─ routes/{auth.ts,worlds.ts,levels.ts,sessions.ts,progress.ts,spellbook.ts,daily.ts,health.ts}
│  │  │  ├─ ws/sessionSocket.ts
│  │  │  ├─ sandbox/{provider.ts,dockerProvider.ts,sessionManager.ts,reaper.ts,sidecars.ts}
│  │  │  ├─ engine/{levelLoader.ts,setupCompiler.ts,checkRunner.ts,checks/*.ts,objectiveTracker.ts,scoring.ts,coach.ts,hints.ts}
│  │  │  ├─ progression/{xp.ts,skills.ts,badges.ts,streaks.ts,review.ts}
│  │  │  └─ util/{logger.ts,tar.ts,ids.ts}
│  │  └─ test/
│  └─ web/
│     ├─ index.html
│     └─ src/
│        ├─ main.tsx, App.tsx, strings.ts, theme.css
│        ├─ api/{client.ts,ws.ts}
│        ├─ state/{useGame.ts,useSession.ts}
│        ├─ pages/{Landing.tsx,WorldMap.tsx,Level.tsx,Spellbook.tsx,Skills.tsx,Profile.tsx,Settings.tsx}
│        └─ components/{TerminalView.tsx,QuestPanel.tsx,ObjectiveList.tsx,HintDrawer.tsx,TuxBubble.tsx,CompleteModal.tsx,MobileKeyBar.tsx,XpBar.tsx,SkillGraph.tsx,...}
├─ packages/
│  ├─ shared/                   # zod schemas + TS types shared by server & web
│  │  └─ src/{level.ts,checks.ts,protocol.ts,api.ts,skills.ts,index.ts}
│  ├─ levels/                   # ALL game content
│  │  ├─ skills.yaml
│  │  ├─ badges.yaml
│  │  ├─ coach.yaml             # global error-coach rules
│  │  └─ content/
│  │     ├─ w1/01-first-words/{level.yaml,solution.sh,wrong/*.sh,setup/*,checks/*}
│  │     └─ ...
│  └─ sandbox-images/
│     ├─ base/{Dockerfile,tq/…}  # tq-base image + helper scripts
│     ├─ web/Dockerfile          # sidecar: nginx + fake API
│     ├─ ssh/Dockerfile          # sidecar: sshd target
│     └─ dns/Dockerfile          # sidecar: dnsmasq
└─ tools/
   ├─ level-runner/             # CLI: `pnpm levels:test`, `pnpm levels:lint`
   └─ scripts/
```

### 3.1 Root `package.json` scripts (must exist)
```
dev            # run server (tsx watch) and web (vite) concurrently
build          # build shared, server, web
lint           # eslint + prettier --check
test           # vitest (unit + integration not needing docker)
verify         # build && lint && test
images:build   # docker build all images in packages/sandbox-images
levels:lint    # validate every level.yaml against zod schema + extra rules (§12.3)
levels:test    # run reference/wrong solutions for levels in Docker (§12). Accepts `--level <id>` and `--world <n>`
e2e            # playwright smoke test
db:migrate     # drizzle migrations
```

---

## 4. System Architecture

```
Browser (React + xterm.js)
   │  REST (JSON)                      │  WebSocket /ws/sessions/:id
   ▼                                   ▼
Fastify server ── SessionManager ── SandboxProvider(DockerProvider) ── Docker Engine
   │                 │   ├─ create/destroy containers + sidecars + networks
   │                 │   ├─ interactive shell (exec with TTY, hijacked duplex stream)
   │                 │   ├─ watcher execs: tail cmdlog / tux inbox
   │                 │   └─ one-shot execs for setup & checks (as root)
   │                 └─ LevelEngine (setup, ObjectiveTracker, CheckRunner, Scoring, Coach, Hints)
   └─ SQLite (users, attempts, progress, skills, notes, badges, events)
```

### 4.1 Attempt lifecycle
1. `POST /api/levels/:levelId/start` → server verifies level unlocked → `SessionManager.create`:
   a. Pick `seed` (random 32-bit int).
   b. Create network/sidecars if level needs them.
   c. Create container from level image with profile security options (§7.3).
   d. Upload files (tar) and run compiled setup script as root with `TQ_SEED`.
   e. Start the player shell exec (as user `player`), start watchers.
   f. Return `{ sessionId }`.
2. Client opens WebSocket `/ws/sessions/:sessionId`, receives `session_state`, streams terminal I/O.
3. On each logged command (cmdlog event) or explicit `check` message → `ObjectiveTracker.evaluate()` runs checks for incomplete objectives → emits `objective` messages.
4. When all non-optional objectives are complete → run `hold` objectives once more → compute score → persist → emit `level_complete`. The terminal stays usable until the user leaves.
5. Session ends on: user leaves (`DELETE /api/sessions/:id`), idle TTL (15 min no stdin), max age (60 min), or server shutdown. Container, sidecars, network are destroyed.

### 4.2 State ownership
- **Server is authoritative** for objective state, hints used, score. Client only renders.
- Active sessions live in memory (`Map<sessionId, Session>`). On server start, `reaper` removes any orphan containers/networks labelled `tq.managed=true`.

---

## 5. Data Model (SQLite, Drizzle)

Create these tables (names/columns exactly; add indexes on foreign keys):

```sql
users(
  id TEXT PRIMARY KEY,               -- uuid v4
  created_at INTEGER NOT NULL,       -- unix seconds
  display_name TEXT,                 -- nullable
  xp INTEGER NOT NULL DEFAULT 0,
  streak_days INTEGER NOT NULL DEFAULT 0,
  last_active_day TEXT               -- 'YYYY-MM-DD' UTC
);
auth_tokens(
  token_hash TEXT PRIMARY KEY,       -- sha256 of cookie token
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL
);
attempts(
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  level_id TEXT NOT NULL,
  seed INTEGER NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  status TEXT NOT NULL,              -- 'active'|'completed'|'abandoned'|'expired'
  hints_used INTEGER NOT NULL DEFAULT 0,
  hint_tiers_json TEXT NOT NULL DEFAULT '[]',
  commands_count INTEGER NOT NULL DEFAULT 0,
  used_manual INTEGER NOT NULL DEFAULT 0,   -- 0/1
  xp_awarded INTEGER NOT NULL DEFAULT 0,
  rank TEXT                          -- 'S'|'A'|'B'|'C'
);
level_progress(
  user_id TEXT NOT NULL REFERENCES users(id),
  level_id TEXT NOT NULL,
  best_rank TEXT,
  best_xp INTEGER NOT NULL DEFAULT 0,
  completions INTEGER NOT NULL DEFAULT 0,
  first_completed_at INTEGER,
  PRIMARY KEY (user_id, level_id)
);
skill_progress(
  user_id TEXT NOT NULL REFERENCES users(id),
  skill_id TEXT NOT NULL,
  uses INTEGER NOT NULL DEFAULT 0,             -- successful uses detected across attempts
  levels_used_json TEXT NOT NULL DEFAULT '[]', -- distinct level ids
  mastered_at INTEGER,                         -- set when used in >=3 distinct levels
  last_used_at INTEGER,
  PRIMARY KEY (user_id, skill_id)
);
spellbook_notes(
  user_id TEXT NOT NULL REFERENCES users(id),
  skill_id TEXT NOT NULL,
  note TEXT NOT NULL,                          -- max 2000 chars
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, skill_id)
);
badges(
  user_id TEXT NOT NULL REFERENCES users(id),
  badge_id TEXT NOT NULL,
  earned_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, badge_id)
);
events(                                         -- telemetry, no PII
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT, level_id TEXT, attempt_id TEXT,
  type TEXT NOT NULL,   -- level_start|objective_complete|hint_used|level_complete|level_abandon|check_timeout|sandbox_error
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);
```

---

## 6. API Specification

All JSON. Base path `/api`. Authentication: httpOnly, SameSite=Lax cookie `tq_session` containing a random 32-byte token (store only its sha256 in `auth_tokens`). Guest accounts are created on first call to `POST /api/guest`.

| Method & path | Purpose | Response (shape in `packages/shared/src/api.ts`) |
|---|---|---|
| `GET /healthz` | liveness + docker reachable | `{ ok, docker: boolean }` |
| `POST /api/guest` | create guest + set cookie (idempotent if cookie valid) | `{ user }` |
| `GET /api/me` | current user, player level, xp, streak, badges | `{ user, playerLevel, xpToNext, badges[] }` |
| `GET /api/worlds` | worlds with levels and per-level state | `{ worlds: [{ id, title, blurb, levels: [{ id, title, kind, difficulty, estimatedMinutes, state: 'locked'|'available'|'completed', bestRank? }] }] }` |
| `GET /api/levels/:id` | public level info (NO checks, setup, solutions) | `{ id, title, story, kind, objectives:[{id,text,optional,bonus}], teaches[], parCommands, xp, hintCount }` |
| `POST /api/levels/:id/start` | start attempt | `{ sessionId, wsPath }` (429 if capacity reached with `Retry-After`) |
| `DELETE /api/sessions/:id` | end attempt (abandon) | `{ ok }` |
| `POST /api/sessions/:id/reset` | destroy & recreate sandbox with a **new seed**, same attempt row marked abandoned, new attempt created | `{ sessionId, wsPath }` |
| `GET /api/progress` | per-level progress summary | `{ levels: {...}, totals }` |
| `GET /api/skills` | skill graph with user mastery | `{ skills: [{id,title,group,prereqs[],uses,masteredAt?}] }` |
| `GET /api/spellbook` | unlocked skills with cheat entries + notes | `{ entries: [{ skillId, title, cheatsheet[], examples[], note? }] }` |
| `PUT /api/spellbook/:skillId/note` | save note `{ note }` (≤2000 chars) | `{ ok }` |
| `GET /api/spellbook/export` | markdown export of spellbook | `text/markdown` |
| `GET /api/daily` | today's daily challenge descriptor | `{ levelId, date, completed }` |
| `GET /api/review` | skills due for review (§10.5) | `{ due: [{skillId, levelId}] }` |

**Rules**
- Unlock logic: first level of World 1 is always available; a level is available if the previous level in the same world is completed; first level of world N+1 requires the boss of world N completed. Env var `UNLOCK_ALL=1` unlocks everything (dev only).
- `GET /api/levels/:id` must never leak `check`, `setup`, `solutions`, or hint text (hints are served only via the socket when requested).
- Rate limits: 60 req/min/IP general; `start` limited to 10/min/user.
- Max 1 active session per user (starting a new one ends the old one).

### 6.1 WebSocket protocol (`/ws/sessions/:sessionId`)
Text frames containing JSON; shared zod schemas in `packages/shared/src/protocol.ts`.

**Client → Server**
```ts
{ t: 'stdin', d: string }                  // keystrokes (UTF-8)
{ t: 'resize', cols: number, rows: number }
{ t: 'hint' }                              // request next hint tier
{ t: 'check' }                             // force re-evaluation
{ t: 'ping' }
```
**Server → Client**
```ts
{ t: 'session_state', level: PublicLevel, objectives: [{id, status:'pending'|'done'}], hintsUsed: number, hintsTotal: 3, completed: boolean }
{ t: 'stdout', d: string }                 // terminal output (decoded UTF-8, boundary-safe)
{ t: 'objective', id: string, status: 'done'|'pending' }
{ t: 'hint', tier: 1|2|3, text: string, penaltyPct: number }
{ t: 'tux', text: string }                 // in-world message (from `tux` CLI or events)
{ t: 'coach', text: string }               // error-coach tip
{ t: 'level_complete', result: { xp:number, rank:'S'|'A'|'B'|'C', breakdown:[{label,xp}], newBadges: string[], unlocked: string[], explain: ExplainCard[], skillsGained: string[] } }
{ t: 'closing', reason: 'idle'|'max_age'|'server_shutdown'|'replaced'|'abandoned' }
{ t: 'error', message: string }
{ t: 'pong' }
```
Behavioural rules: stdin frames are rate-limited (max 64 KB/s); frames > 16 KB are rejected; WebSocket closes with code 4401 if the cookie user does not own the session.

---

## 7. Sandbox Specification

### 7.1 Images
**`tq-base`** (Debian 12 slim). Install: `bash coreutils findutils grep sed gawk less nano vim man-db manpages manpages-dev procps psmisc iproute2 iputils-ping curl netcat-openbsd dnsutils openssh-client tar gzip bzip2 xz-utils zip unzip jq cron rsync tmux git sudo lsof strace shellcheck bats file tree ncurses-term locales python3 python3-croniter` (python only for checkers).
- Users: `player` (uid 1000, home `/home/player`, shell bash). Root exists for checks.
- Remove `su` abilities for player unless profile `admin`. Sudo config differs by profile (see below).
- `/opt/tq/` (root-owned, mode 755, not writable by player) contains:
  - `bashrc` — the interactive shell rc (§7.4)
  - `bin/tux` — helper CLI (§7.5)
  - `bin/*` — checker helpers (`cronmatch.py`, `modeof.sh`, etc.)
  - `cheats/` — simplified tldr-style pages used by `tldr` shim (`tldr <cmd>` prints from `/opt/tq/cheats/<cmd>.txt`, falls back to `man`)
- `/run/tq/` created at setup by root with files `cmdlog` and `inbox` (mode 0622, root-owned). Also `/opt/tq/secret/` (root, 0700) for seeded answers.
- MOTD/ENV: `LANG=C.UTF-8`, `TERM=xterm-256color`, `HISTSIZE=10000`.

### 7.2 `SandboxProvider` interface (`apps/server/src/sandbox/provider.ts`)
```ts
export interface SandboxSpec {
  attemptId: string; userId: string; levelId: string;
  image: string; profile: 'basic'|'admin'; network: 'none'|'lan';
  sidecars: string[]; resources: { memoryMb: number; cpus: number; pids: number };
  startCwd: string; env: Record<string,string>;
}
export interface ExecResult { code: number; stdout: string; stderr: string; timedOut: boolean }
export interface ShellStream {
  write(data: string): void; resize(cols: number, rows: number): void;
  onData(cb: (chunk: Buffer)=>void): void; onClose(cb: ()=>void): void; close(): void;
}
export interface SandboxHandle { id: string; spec: SandboxSpec }
export interface SandboxProvider {
  create(spec: SandboxSpec): Promise<SandboxHandle>;
  putFiles(h: SandboxHandle, entries: {path:string; content: Buffer; mode: number; uid?: number; gid?: number}[]): Promise<void>;
  exec(h: SandboxHandle, cmd: string[], opts?: { user?: string; env?: Record<string,string>; cwd?: string; timeoutMs?: number; stdin?: string }): Promise<ExecResult>;
  openShell(h: SandboxHandle, size: {cols:number; rows:number}): Promise<ShellStream>;
  watchFile(h: SandboxHandle, path: string, onLine: (line: string)=>void): Promise<{ stop(): void }>;
  destroy(h: SandboxHandle): Promise<void>;
  listManaged(): Promise<{ containerId: string; attemptId: string; createdAt: number }[]>;
}
```
Implement `DockerProvider` with dockerode. Key technique for the interactive shell:
```ts
const exec = await container.exec({ Cmd: ['/bin/bash','--rcfile','/opt/tq/bashrc','-i'], User: 'player',
  WorkingDir: startCwd, Env: ['TERM=xterm-256color','LANG=C.UTF-8', ...], AttachStdin: true, AttachStdout: true, AttachStderr: true, Tty: true });
const stream = await exec.start({ hijack: true, stdin: true, Tty: true });
// write: stream.write(data); resize: exec.resize({ h: rows, w: cols });
```
Use `string_decoder.StringDecoder('utf8')` when converting chunks to `stdout` strings so multi-byte characters are not split.

### 7.3 Container security profiles
Always (all profiles):
- Labels: `tq.managed=true`, `tq.attempt=<id>`, `tq.user=<id>`, `tq.level=<id>`, `tq.created=<unix>`.
- `--cap-drop ALL` then add back only what the profile needs.
- `--pids-limit` (default 128), `--memory` (default 256m, swap = same), `--cpus` (default 0.5), ulimits: `nofile=1024`, `nproc` = pids, `core=0`.
- `--network none` unless level `network: lan`.
- No `--privileged`, no docker socket, no host mounts (except the optional read-only `/opt/tq` if not baked into the image; prefer baked in).
- `/tmp` as tmpfs `size=32m,noexec,nosuid`. `/home/player` on the container layer (needs exec for scripts levels) — protect with pids/memory limits and a per-session TTL. If `SANDBOX_RUNTIME` env is set (e.g. `runsc`), pass `--runtime`.

| Profile | Extra | Capabilities added back |
|---|---|---|
| `basic` | `no-new-privileges`, no sudo | `CHOWN, DAC_OVERRIDE, FOWNER, SETUID, SETGID, KILL` (needed by root-run checks/setup; player stays unprivileged) |
| `admin` | sudo enabled for `player` (NOPASSWD, but a restricted command list per level via `/etc/sudoers.d/tq`; default allow-list: package, user, service, chown/chmod/chgrp, kill, mount-less admin tools), cron daemon started, optional `NET_RAW`/`NET_ADMIN` only for levels that set `capabilities:` explicitly | `+ AUDIT_WRITE, SYS_CHROOT, NET_BIND_SERVICE` |

### 7.4 `/opt/tq/bashrc`
```bash
# sourced by the interactive shell
[ -f /etc/bash.bashrc ] && . /etc/bash.bashrc
export PS1='\[\e[32m\]\u@penguin-corp\[\e[0m\]:\[\e[36m\]\w\[\e[0m\]\$ '
export PATH="/opt/tq/bin:$PATH"
shopt -s histappend checkwinsize
HISTCONTROL=ignoredups
__tq_last_n=""
__tq_log() {
  local ec=$?
  local n cmd
  read -r n cmd < <(HISTTIMEFORMAT= history 1)
  if [ -n "$n" ] && [ "$n" != "$__tq_last_n" ]; then
    __tq_last_n="$n"
    printf '%s\t%s\t%s\t%s\n' "$(date +%s)" "$ec" "$PWD" "${cmd//$'\n'/ }" >> /run/tq/cmdlog 2>/dev/null
  fi
  return $ec
}
PROMPT_COMMAND="__tq_log"
# Level-specific rc additions (aliases etc.) are appended by setup if the level defines `setup.rc_extra`.
[ -f "$HOME/.bashrc" ] && . "$HOME/.bashrc"
```
Notes: a repeated empty Enter must not log a duplicate (handled via history number). Commands are logged **after** they finish (so exit code is available). Format per line: `epoch<TAB>exit<TAB>cwd<TAB>command`.

### 7.5 `tux` helper CLI (`/opt/tq/bin/tux`, bash)
Writes one JSON line to `/run/tq/inbox` and prints a short local message.
- `tux hint` → inbox `{"cmd":"hint"}`; prints "Tux: Hint requested. Check the Quest panel →".
- `tux status` → inbox `{"cmd":"status"}`; server replies via `tux` WS message.
- `tux submit <text…>` → inbox `{"cmd":"submit","text":"…"}` (JSON-escape properly with `jq -n --arg`); prints "Answer submitted."
- `tux explain <command…>` → inbox `{"cmd":"explain","text":"…"}`; server replies using explain data / man summary (best effort).
- `tux help` → lists the above.
Server watches `/run/tq/inbox` via `watchFile` and handles each line (`submit` stores answers in the in-memory session `answers[]` used by `answer_equals` checks, then triggers an evaluation).

### 7.6 Lifecycle & resource management
- `MAX_CONTAINERS` (default 20 dev / 100 prod): if exceeded, `start` returns 429.
- Idle TTL 15 min (no stdin), max age 60 min. `reaper` runs every 30 s and on boot.
- `destroy` = stop (timeout 1 s) + remove container (force, with volumes) + remove sidecars + remove per-session network.
- Pre-pull/build images in `images:build`; `start` must fail fast (clear error) if image missing.

### 7.7 Networked levels (`network: lan`, M10)
- Per-session user-defined bridge network `tq-<attemptId>` with `Internal: true` (no internet).
- Sidecars (each its own image/container, joined with aliases):
  - `web` → alias `web.penguin.corp` (nginx serving static pages + a small JSON API at `/status`, `/api/users`, with a fixed 404 and a custom header).
  - `ssh` → alias `ssh.penguin.corp` (sshd, user `deploy`, password disabled, accepts key from `/home/player/.ssh/…` when level setup installs it via `sidecar_setup`).
  - `dns` → alias `dns.penguin.corp` (dnsmasq with records like `db.penguin.corp`), and the player container's resolver points at it.
- Sidecar definitions live in `apps/server/src/sandbox/sidecars.ts`.

---

## 8. Level Definition Format

Each level lives in `packages/levels/content/w<N>/<NN>-<slug>/`:
```
level.yaml        # required
solution.sh       # required: reference solution (runs as player via bash -l)
wrong/*.sh        # recommended: plausible wrong attempts that must NOT complete the level
setup/            # files referenced by level.yaml (content_file, generators)
checks/           # custom check scripts referenced by `exec` checks
```
`id` = `w<N>-<NN>-<slug>` (e.g. `w1-03-moving-around`). The zod schema lives in `packages/shared/src/level.ts`; `levels:lint` enforces it.

### 8.1 `level.yaml` schema

```yaml
id: w2-06-grep-recursive-regex
world: 2
order: 6
title: "The Leaked Key"                 # <= 40 chars
kind: lesson                            # lesson | boss | review | daily
difficulty: 3                           # 1..5
estimated_minutes: 8
story: |                                # markdown, <= 80 words, Tux-9000 voice (§16)
  Someone committed an API key. Find which file leaked it before the auditors do.
teaches: [grep, regex-basics, recursive-search]   # skill ids from skills.yaml (<= 3)
par_commands: 6                         # a good solution's command count (used for ranks)
xp: 75                                  # base XP

sandbox:
  profile: basic                        # basic | admin
  network: none                         # none | lan
  sidecars: []                          # web | ssh | dns
  image: tq-base
  start_cwd: /home/player
  resources: { memory_mb: 256, cpus: 0.5, pids: 128 }
  capabilities: []                      # extra Linux caps (admin only), e.g. [NET_RAW]
  sudo_allow: []                        # extra sudoers commands (admin only)

setup:                                  # all executed as root BEFORE the shell starts
  dirs: [ { path: /home/player/config, owner: player, mode: "755" } ]
  files:
    - { path: /home/player/config/app.env, owner: player, mode: "644", content: "DEBUG=false\n" }
    - { path: /home/player/README.txt, owner: player, content_file: setup/readme.txt }
  generators:                           # scripts run as root; env TQ_SEED=<int>; must be deterministic per seed
    - { script: setup/gen.sh }          # writes data files and may write answers to /opt/tq/secret/<name>
  commands:                             # extra root shell commands, run in order after files/generators
    - "chown -R player:player /home/player"
  rc_extra: |                           # appended to player's ~/.bashrc (optional)
    alias ls='ls --color=auto'

objectives:
  - id: find-leak
    text: "Find the file that contains the leaked key (it starts with AKIA) and submit its filename."
    check: { type: answer_equals, from_file: /opt/tq/secret/leak_file }
  - id: used-recursive
    text: "Bonus: do it with a single recursive grep."
    bonus: true                         # not required; adds bonus XP
    check: { type: command_used, regex: '^grep\s+(-\w*r\w*|-r)\b' }

hints:                                  # exactly 3 tiers: nudge, hint, near-solution
  - "Which command searches inside files? Think 'global regular expression print'."
  - "grep can search a whole directory tree. Check `grep --help | grep recursive`."
  - "Try: grep -rn 'AKIA' ~/config  — then submit the filename with `tux submit <name>`."

coach:                                  # optional level-specific error coach rules
  - when: { exit_code: 2, command_regex: '^grep\s' }
    say: "Exit code 2 from grep usually means a bad path or flag. Check spelling and quoting."

explain:                                # shown on completion ("What just happened?")
  - command: "grep -rn 'AKIA' ~/config"
    parts:
      - { token: "grep",   meaning: "search text for a pattern" }
      - { token: "-r",     meaning: "recurse into subdirectories" }
      - { token: "-n",     meaning: "show line numbers" }
      - { token: "'AKIA'", meaning: "the pattern (quoted so the shell leaves it alone)" }
      - { token: "~/config", meaning: "where to search" }

cheatsheet:                             # contributes to the spellbook
  - { skill: grep, syntax: "grep [-rniv] PATTERN [PATH...]", note: "Search file contents. -r recursive, -n line numbers, -i ignore case, -v invert." }

success_message: "Key found. Tux-9000 is already filing the incident report."
forbidden_commands: []                  # regexes against logged commands; if matched, show a tux warning (not a fail) — used sparingly
solutions:
  reference: solution.sh
  wrong: [wrong/guess.sh]
```

### 8.2 Check types (discriminated union on `type`)
All paths are absolute inside the sandbox. Checks run as **root** using `env -i PATH=/usr/bin:/bin:/opt/tq/bin HOME=/root`, with a 5 s timeout each (timeout ⇒ fail + `check_timeout` event). Every type is implemented in `apps/server/src/engine/checks/<type>.ts` with unit tests.

| `type` | Fields | Semantics |
|---|---|---|
| `file_exists` | `path`, `kind?: file\|dir\|symlink\|any` (default any) | Exists (and is of kind) |
| `file_absent` | `path` | Does not exist (`test ! -e`, also false for broken symlink → use `-L` aware test) |
| `file_content` | `path`, one of `equals`, `contains`, `matches` (regex), `sha256`, `lines_equal_unordered` (string[]), plus `trim?: bool` (default true) | Content comparison. Values may reference `{{secret:name}}` (read from `/opt/tq/secret/name`) |
| `file_mode` | `path`, `mode` (octal string, e.g. `"600"`) | Exact permission bits (`stat -c %a`) |
| `file_owner` | `path`, `user?`, `group?` | Ownership |
| `symlink_target` | `path`, `target` | `readlink` equals |
| `dir_listing` | `path`, `equals` (string[]), `ignore_hidden?: bool` | Sorted entry names equal |
| `shell_cwd` | `equals` | Player's shell cwd. Implementation: `readlink /proc/$(pgrep -o -u player -x bash)/cwd` |
| `command_used` | `regex`, `min_count?: number` (default 1), `exit_code?: number` (default 0 i.e. must have succeeded; use `any` to ignore) | Search the attempt's parsed cmdlog |
| `answer_equals` | `value?` or `from_file?`, `case_sensitive?: bool`, `trim?: bool` | Compares latest `tux submit` text |
| `process_running` | `name?` or `cmdline_regex?`, `user?` | `pgrep` match exists |
| `process_absent` | same | no match |
| `process_state` | `cmdline_regex`, `state` (`R\|S\|T\|Z`) | From `ps -o stat=` first char |
| `port_listening` | `port`, `proto?: tcp\|udp` | via `ss -lntu` |
| `crontab_entry` | `user`, `schedule` (5-field string or alias), `command_regex` | Parses `crontab -l -u user` (as root); matches schedule semantically using `cronmatch.py` |
| `cron_dry_run` | `user`, `entry_index?` or `command_regex`, `expect` (as `file_content`-style assertions), `timeout_s?` | Executes the crontab line's command as that user with a **cron-like minimal env** (`env -i HOME=… LOGNAME=… SHELL=/bin/sh PATH=/usr/bin:/bin`, cwd=HOME, `sh -c`) then evaluates `expect` |
| `login_shell_eval` | `user`, `script`, `stdout_equals?`/`stdout_matches?` | Runs `su - user -c "<script>"` (or `bash -lc`) as root and compares output; used for env/alias/PATH levels |
| `script_tests` | `path`, `cases[]`, `shellcheck?: bool` | For script-writing levels (§8.3) |
| `exec` | `script` (path under level `checks/`, uploaded to `/opt/tq/checks/`) or `inline`, `expect_exit?: 0`, `stdout_matches?` | Escape hatch. Script receives `TQ_SEED`; must be idempotent & read-only |
| `all` / `any` / `not` | `checks: [...]` | Combinators |

Additional rule: objectives are **sticky** by default (once true they stay done). Set `hold: true` to require the check to be true again at completion time (e.g. "important file still exists").

### 8.3 `script_tests` cases
```yaml
check:
  type: script_tests
  path: /home/player/backup.sh
  shellcheck: true               # fail if `shellcheck -S warning` reports issues (optional)
  cases:
    - name: "usage on no args"
      args: []
      expect: { exit_code: 64, stderr_matches: "Usage:" }
    - name: "creates archive"
      setup: [ "mkdir -p /tmp/t/src && echo hi > /tmp/t/src/a.txt" ]   # run as player in a scratch dir
      args: ["/tmp/t/src", "/tmp/t/dst"]
      stdin: ""
      env: { TZ: UTC }
      expect:
        exit_code: 0
        stdout_matches: "Backup complete"
        files: [ { path: "/tmp/t/dst/*.tar.gz", exists: true } ]
```
Rules: each case runs in a fresh scratch dir under `/tmp/tq-case-<n>` (owned by player), 10 s timeout, using the player's own script path, as user `player`. Hidden extra cases (marked `hidden: true`) are allowed and expected to prevent hard-coding.

### 8.4 Randomization
Levels with `seeded` data should use generators so answers differ per attempt. A generator is a bash script run as root with `TQ_SEED`; use `RANDOM=$TQ_SEED` for determinism; write answers to `/opt/tq/secret/<name>` (mode 0600). Checks reference them via `from_file` or `{{secret:name}}`. `levels:test` runs each level with 3 different seeds.

---

## 9. Frontend Specification

### 9.1 Visual design
Dark "terminal hacker meets friendly office" aesthetic. Tokens (CSS variables in `theme.css`, also mapped in Tailwind config):
```
--bg:#0b0f14; --panel:#11171e; --panel-2:#161e27; --border:#243040;
--text:#d7e0ea; --muted:#8aa0b5; --green:#3ddc84; --amber:#ffb454; --red:#ff6b6b; --cyan:#5ccfe6; --purple:#b78cff;
```
Fonts: JetBrains Mono (terminal, code, headings accents), Inter (UI text). Respect `prefers-reduced-motion` (disable confetti/animations). Support a high-contrast toggle and font-size setting (Settings page, stored in `localStorage`).

### 9.2 Pages
1. **Landing** (`/`): hero, 1-line pitch, "Start playing" → calls `POST /api/guest` then routes to `/map`. Show an animated fake terminal typing the first command.
2. **World map** (`/map`): five world cards in a vertical path; each shows levels as nodes (locked/available/completed with rank badge). Click available level → `/play/:levelId`. Header: XpBar (player level, XP), streak flame, links to Spellbook/Skills/Profile.
3. **Level** (`/play/:levelId`) — the core screen (§9.3).
4. **Spellbook** (`/spellbook`): searchable list of unlocked skills with cheat entries + editable personal note; "Export markdown" button.
5. **Skills** (`/skills`): `SkillGraph` — nodes grouped by world with prerequisites as edges; mastered nodes glow. Implement with plain SVG + simple layered layout (no heavy graph lib).
6. **Profile** (`/profile`): display name edit, badges grid, stats (levels done, hints used, favorite command from cmdlog counts is optional).
7. **Settings** (`/settings`): font size, high contrast, reduced motion, "reset progress" (confirm).

### 9.3 Level screen layout
- **Desktop (≥1024px):** left 65% `TerminalView`, right 35% `QuestPanel`. **Mobile/tablet:** stacked, terminal on top (min-height 45vh), panel below in tabs [Mission | Hints | Notes], `MobileKeyBar` fixed above the keyboard.
- **QuestPanel** shows: Tux avatar (ASCII penguin) + story bubble; `ObjectiveList` (checkbox per objective, animate on completion; bonus objectives labelled); hint button "Need a hint? (−5% XP)" showing remaining tiers and revealed hints in a list; "Reset level" (confirm) and "Leave level".
- **TerminalView:** xterm.js, fit on container resize (debounced, send `resize`), font JetBrains Mono, scrollback 5000, `cursorBlink`, theme from tokens. Clicking the panel focuses the terminal. Show connection status; auto-reconnect WebSocket up to 3 times with backoff (the session persists server-side while alive).
- **CompleteModal:** rank (S/A/B/C) with animation, XP breakdown, newly learned skills, "What just happened?" cards (from `explain`), badges earned, buttons [Next level] [Replay for rank] [Back to map].
- **TuxBubble** displays `tux` and `coach` messages as transient toasts in the panel.

### 9.4 State management
`useGame` (user, worlds, progress, spellbook cache) and `useSession` (socket, objectives, hints, completion). API calls through `api/client.ts` with typed zod parsing.

### 9.5 Accessibility
Keyboard-only navigation of all non-terminal UI; ARIA live region announces objective completions ("Objective complete: …"); sufficient contrast; focus is never trapped in the terminal (provide Escape-twice or a visible "Leave terminal" button; document Ctrl+Alt+M? — simply provide the button).

### 9.6 Mobile key bar
Buttons sending raw sequences through `stdin`: `Tab \t`, `Ctrl` (toggle modifier, next letter → control code), `Esc \x1b`, `↑ \x1b[A`, `↓ \x1b[B`, `← \x1b[D`, `→ \x1b[C`, `|`, `~`, `/`, `-`, `Ctrl+C \x03`, `Ctrl+D \x04`.

---

## 10. Game Mechanics

### 10.1 XP and scoring (`engine/scoring.ts`)
```
base = level.xp
hintPenaltyPct = sum of tier penalties used (tier1 5, tier2 10, tier3 25) -> max 40
xp = round(base * (1 - hintPenaltyPct/100))
+ firstClearBonus: +10% of base if first completion of the level
+ manualBonus: +5 flat if the log contains man|--help|-h|tldr usage (regex on command)
+ bonusObjectives: +10 flat each completed bonus objective
+ repeat completions: awarded only the improvement over best_xp (never negative)
```
**Rank:**
- **S**: 0 hints AND commands ≤ 1.5 × par AND all bonus objectives done
- **A**: ≤ 1 hint AND commands ≤ 2 × par
- **B**: ≤ 3 hints
- **C**: anything else
Commands counted = lines in cmdlog (deduped), excluding `clear`, `history`, `tux *`.

### 10.2 Player levels
`xpForLevel(n) = round(100 * n^1.5)` cumulative; implement `playerLevel(xp)` and `xpToNext(xp)`.

### 10.3 Skills and mastery
`skills.yaml` entry:
```yaml
- id: grep
  title: "grep"
  group: searching
  world: 2
  prereqs: [pipes-basic]       # optional
  detect: '^(\S+\s+)*grep\b'    # regex on logged commands signalling use (optional; if absent, only `teaches` credit applies)
```
When a level completes: each `teaches` skill gets `uses += 1`, level id added to `levels_used_json`. A skill is **mastered** when it appears in ≥ 3 distinct completed levels OR (for a skill with `detect`) detected in successful commands across ≥ 3 distinct levels. Skills unlock in the spellbook on first completion of a level that teaches them.

### 10.4 Badges (`badges.yaml`)
Each: `id, title, description, rule`. Rules implemented in `progression/badges.ts` as functions over (event, user state). Initial badges: `first-command` (any level done), `pipe-dream` (complete a level whose command log includes a pipeline with ≥4 stages), `no-hints-world` (finish a world with 0 hints), `zombie-slayer` (w3-05), `cron-whisperer` (w4-12 & w4-13 at rank ≥B), `streak-3`, `streak-7`, `s-rank-10` (10 S ranks), `vim-escape` (w2-14), `boss-1..5`.

### 10.5 Streaks, daily, review
- **Streak:** increments when the user completes ≥1 level on a new UTC day; resets if a day is skipped.
- **Daily challenge:** deterministic selection `levels[ hash(date) % N ]` from levels flagged `daily_eligible: true` (add this optional field; default true for lessons with difficulty ≤3 in completed worlds).
- **Review (spaced repetition, M6):** for each mastered/learned skill, if `now - last_used_at > interval` (intervals 3d, 7d, 21d by `uses`), offer a `review` level: any completed level teaching that skill, replayed with a new seed. `GET /api/review` lists due items. Replays award reduced XP (25% of base) but update `last_used_at`.

### 10.6 Hints
Tier request order 1→2→3; each reveals `hints[tier-1]` via socket; penalties as in §10.1. Hints are per attempt and reset on `reset`. If an objective is stuck for 3 minutes of no progress and ≥3 commands logged with non-zero exit, Tux offers (via `tux` message) "Want a hint? Click the hint button." — message only, never auto-reveal.

### 10.7 Error coach (`engine/coach.ts`, global rules in `coach.yaml`)
We log exit codes but not stderr. Rules match `(exit_code, command_regex)` and optionally the level's `coach` list (checked first). Emit at most 1 coach message per 20 s; never repeat the same rule more than twice per attempt. Starter global rules:
- exit 127 → "command not found — check spelling, or the program may not be installed."
- exit 126 → "Found but not executable. Is the permission bit set? (`ls -l`)."
- exit 1 + `^rm\b` → "rm refused. Is it a directory? (`rm -r` for directories — carefully.)"
- exit 1 + `^cd\b` → "No such directory. Use `ls` to see what's here, and `pwd` to confirm where you are."
- exit 2 + `^ls\b` → "ls couldn't find that path."
- exit 1 + `^(cp|mv)\b` → "Check source and destination paths exist; destination directory needs a trailing / or to exist."
- exit 126/1 + `^\./` → "To run a script in the current dir use `./name` and make sure it's executable (chmod +x)."
- exit 2 + `^grep\b` → "Bad grep usage or path. Quote patterns with special characters."
- exit 1 + `^(cat|less|head|tail)\b` → "That file doesn't exist or you can't read it (`ls -l`)."
Add more as levels need them.

### 10.8 Reset behaviour
`POST /api/sessions/:id/reset` destroys everything and creates a fresh sandbox with a **new seed** (so shared answers don't work), marks the old attempt `abandoned`, increments no XP. Hints used does NOT carry over to the new attempt.

---

## 11. Curriculum (the content to author)

### 11.1 Tiers
🌱 Noob (W1) · 🔧 Apprentice (W2) · ⚙️ Practitioner (W3) · 🛠️ Engineer (W4) · 🧙 Pro (W5).

### 11.2 Narrative frame
Player is a new hire at **Penguin Corp**; mentor **Tux-9000** (grumpy, dry, secretly proud of you) hands out missions escalating from "find my lost file" to "production is on fire". World names: 1 *The Lobby*, 2 *The Filing Room*, 3 *The Engine Room*, 4 *The Automation Lab*, 5 *The War Room*.

### 11.3 Level tables
Legend — **Profile**: B=basic, A=admin. **Net**: none/lan. **Needs**: infra dependency. "answer" = uses `tux submit` with seeded secret. XP base: W1 50, W2 75, W3 100, W4 150, W5 200 (boss ×2).

#### World 1 — The Lobby (12 levels) — all `basic`, `none`
| ID | Title | New skills | Player task | Primary checks |
|---|---|---|---|---|
| w1-01-first-words | First Words | `echo`, `whoami` | Guided: UI pre-fills `echo hello`; then run `whoami` | `command_used` echo; `command_used` `^whoami$` |
| w1-02-where-am-i | Where Am I? | `pwd`, `ls` | Run `pwd` and `ls`; one visible file has a seeded name `welcome-<word>.txt`; submit that word | `command_used` pwd, ls; `answer_equals` secret |
| w1-03-moving-around | Moving Around | `cd`, `.`/`..`/`~`, `cd -` | Navigate a seeded office tree to `~/office/floor2/room204` | `shell_cwd`; `command_used` `cd -`? (bonus) |
| w1-04-paths | Absolute vs Relative | absolute/relative paths | `cd /var/log` using an absolute path, then to `../../home/player/office` using relative | `command_used` regexes (`^cd /var/log`, `^cd \.\./`); `shell_cwd` |
| w1-05-peek-inside | Peek Inside | `ls -lah`, hidden files, `cat` | Find hidden `.secret` in a folder, `cat` it, submit passphrase | `answer_equals`; `command_used` `ls\s+-\w*a` |
| w1-06-make-things | Make Things | `mkdir`, `mkdir -p`, `touch` | Create `projects/alpha/notes.txt` and `projects/beta/` | `file_exists` x3 |
| w1-07-copy-and-move | Copy & Move | `cp`, `mv`, rename | Copy `report.txt` to `backup/`, rename `draft.txt` → `final.txt`, move `photo.jpg` into `pictures/` | `file_exists/absent` + `file_content sha256` |
| w1-08-delete-carefully | Delete Carefully | `rm`, `rmdir`, `rm -r`, `rm -i` | Delete junk files and an empty dir and a junk tree, keep `important.txt` | `file_absent` x N; `file_exists` important (`hold: true`) |
| w1-09-reading-files | Reading Files | `head`, `tail`, `less` | Seeded 500-line file: submit its first line, last line (two answers) and line 1 of `tail -n 3` | `answer_equals` x3 |
| w1-10-manual-labor | Manual Labor | `man`, `--help` | Find the `ls` flag that sorts by size; use it; submit the largest file's name | `command_used` `ls\s+.*-\w*S`; `answer_equals`; bonus `command_used` `man\|--help` |
| w1-11-time-travel | Time Travel | history, Ctrl+R, Tab | A file named `quarterly-financial-report-final-v3-REAL.txt`: `cat` it; run `history`; re-run a previous command with `!!` or `!n` | `command_used` cat quarterly; `command_used` history; `command_used` `^!!?\d*$`… (note: bash expands history, so detect via duplicate command lines) |
| w1-12-boss-organize-chaos | **Boss: Organize the Chaos** | consolidates W1 | Messy home with ~30 seeded files (`.jpg .txt .pdf .log`): create `Documents/ Pictures/ Logs/`, move each file to the right place, delete `tmp/` | `exec` check verifying every original file exists exactly once in the right dir, `tmp/` absent, no stray files |

#### World 2 — The Filing Room (15 levels) — all `basic`, `none`
| ID | Title | New skills | Player task | Primary checks |
|---|---|---|---|---|
| w2-01-wildcards | Wildcard Wizardry | `*`, `?`, `[]` globs | Move all `*.log` into `logs/`, all `report-?.txt` into `reports/` | `dir_listing` |
| w2-02-brace-expansion | Brace Yourself | brace expansion | Create dirs `2026-01`…`2026-12` and files `{a,b,c}.txt` in `drafts/` | `dir_listing` |
| w2-03-find-by-name | Seek and Find | `find -name/-iname/-type` | Locate all `.conf` files under `/etc/penguin`, write paths to `confs.txt` | `file_content lines_equal_unordered` |
| w2-04-find-by-attrs | Find by Attributes | `find -size/-mtime/-empty/-exec` | Delete empty files and files older than N days in `cache/` using find; keep others | `file_absent` x N, `file_exists` x M (`hold`) |
| w2-05-grep-basics | Grep Basics | `grep -i -n -c -v` | Count ERROR lines (answer); write non-comment lines of `app.conf` to `clean.conf` | `answer_equals`; `file_content` |
| w2-06-grep-recursive-regex | The Leaked Key | `grep -r -E`, anchors | Find which file has the leaked key (`AKIA…`) among 40 configs; submit filename | `answer_equals`; bonus `command_used` |
| w2-07-pipes | Pipe Dreams | `\|`, `wc`, `sort`, `uniq` | Count unique IPs in `access.log`; submit number | `answer_equals` (seeded) |
| w2-08-redirection | Redirect the Flow | `>`, `>>`, `2>`, `&>`, `tee` | Build `report.txt` from two commands (append), send stderr of a failing `ls` to `errors.txt` | `file_content` x2 |
| w2-09-text-tools | Text Surgery | `cut`, `tr`, `sort -nr -k`, `uniq -c`, `head` | Top 3 HTTP status codes from `access.log` into `top3.txt` as `count code` | `file_content equals` (seeded) |
| w2-10-links-and-types | Links & Types | `file`, `stat`, `ln -s`, `ln` | Make `latest -> release-v2`; identify type of mystery file (submit) | `symlink_target`; `answer_equals` |
| w2-11-permissions | Permission Slip | `chmod` octal & symbolic, `ls -l` | Make `deploy.sh` executable, `secret.txt` 600, `shared/` 775 | `file_mode` x3 |
| w2-12-umask-recursive | Mask & Recurse | `umask`, `chmod -R`, `stat -c` | Set umask so new files are 640; create `new.txt`; fix a tree recursively (dirs 755, files 644) | `file_mode`, `exec` tree-verify |
| w2-13-nano | Edit with Nano | `nano` | Change `port=8080` to `port=9090` and add `debug=true` in `server.conf` | `file_content equals` |
| w2-14-vim-survival | Vim Survival | `vim` basics | Using vim: insert text, delete a line (`dd`), search, `:wq`; one file edit chain | `file_content equals`; badge `vim-escape` |
| w2-15-boss-log-detective | **Boss: The Log Detective** | consolidates W2 | Multi-log investigation: submit attacker IP, first failed-login time, targeted user, failed-attempt count; write `report.txt` summarising | `answer_equals` x4; `file_content matches` |

#### World 3 — The Engine Room (15 levels) — `admin` profile
| ID | Title | New skills | Player task | Primary checks | Net / Needs |
|---|---|---|---|---|---|
| w3-01-sudo-and-id | Power & Responsibility | `id`, `sudo` | Read a root-only file via `sudo cat`; submit its secret | `answer_equals` | none |
| w3-02-users-groups | Meet the Team | `useradd`, `usermod -aG`, `getent` | Create user `deploy` with home and in group `www-data` | `exec` getent/id | none |
| w3-03-chown-special-bits | Ownership & Special Bits | `chown -R`, setgid, sticky | Create shared dir for group `dev`: setgid, group-writable, sticky `/tmp`-style | `file_mode`, `file_owner` | none |
| w3-04-ps-and-top | Who's Running? | `ps aux`, `top`, `pgrep` | Find PID of `mystery-daemon` (seeded name/PID); submit | `answer_equals` | none |
| w3-05-signals-kill | Zombie Slayer | `kill`, signals, `pkill` | Kill runaway `cpu_hog` (needs SIGKILL) without killing `important-worker` | `process_absent`, `process_running` (`hold`) | none |
| w3-06-job-control | Job Control | `&`, `jobs`, `fg`, `bg`, `nohup`, `Ctrl+Z` | Start long job in background, stop it, resume it, run another with nohup | `process_state` S/T/R, `process_running` | none |
| w3-07-environment | Make It Yours | env vars, `export`, `PATH`, `.bashrc`, alias | Set `EDITOR=nano`, alias `ll`, add `~/bin` to PATH, run script in `~/bin` by name | `login_shell_eval` x3 | none |
| w3-08-disk-usage | Where Did My Disk Go? | `df`, `du -sh`, `sort -h` | Find directory using most space (submit); delete the biggest log | `answer_equals`; `file_absent` | none |
| w3-09-archives | Pack & Unpack | `tar czf/xzf/tf`, `zip`, `unzip` | Back up `site/` to `site.tar.gz`; restore into `/tmp/restore`; extract a single file | `file_content sha256`, `exec` | none |
| w3-10-networking-basics | Network Recon | `ip a`, `ping`, `ss -tlnp` | Find which port the `intranet` service listens on (seeded); submit | `answer_equals` | lan, sidecar `web` |
| w3-11-curl-and-dns | Talk to the Web | `curl -I -o`, `dig` | Save `http://web.penguin.corp/status` to `status.json`; get `db.penguin.corp` IP via `dig`; submit | `file_content`, `answer_equals` | lan, `web`+`dns` |
| w3-12-ssh-keys | Keys to the Kingdom | `ssh-keygen`, `ssh`, `scp` | Generate key, ssh to `ssh.penguin.corp` as `deploy`, run `hostname`, scp a file over | `exec` (verify remote file via sidecar exec), `answer_equals` | lan, `ssh` |
| w3-13-rsync | Sync Up | `rsync -av --delete -n` | Dry-run then real sync of `site/` to target dir/host; remove stale file at target | `exec` tree diff | lan optional |
| w3-14-packages | Package Deal | `dpkg -i/-l`, `apt-cache` | Install bundled `.deb` tool, verify with `dpkg -l`; run it | `exec` (`command -v tool`) | none; local `.deb` baked at setup |
| w3-15-boss-server-setup | **Boss: Server Setup** | consolidates W3 | Provision: create user, set perms, install tool, start a service in background that listens on port 8080, add ssh key | `process_running`, `port_listening`, `file_owner`, `exec` | lan, `ssh` |

#### World 4 — The Automation Lab (16 levels) — `admin` where noted
| ID | Title | New skills | Player task | Primary checks | Notes |
|---|---|---|---|---|---|
| w4-01-script-hello | Hello, Script | shebang, `chmod +x`, run | Write `hello.sh` that prints "Hello, <name>" using `whoami` | `script_tests` | basic |
| w4-02-variables-quoting | Say It Right | variables, quoting, `$(…)` | Script prints formatted line from variables with spaces in values | `script_tests` (hidden cases w/ spaces) | basic |
| w4-03-args-exit-codes | Arguments & Exit Codes | `$1 $@ $#`, `exit`, `$?` | Script requires 2 args else prints Usage and exits 64 | `script_tests` | basic |
| w4-04-conditionals | If This Then That | `if`, `[[ ]]`, file tests | Script reports whether a path is file/dir/missing | `script_tests` | basic |
| w4-05-loops | Loop de Loop | `for`, `while read`, globs, `seq` | Batch rename files to `.bak`; sum numbers from stdin | `script_tests` | basic |
| w4-06-functions | Functions | functions, `local`, `return` | Refactor given script into functions; behaviour unchanged | `script_tests` | basic |
| w4-07-strict-mode | Fail Fast | `set -euo pipefail`, `trap`, `mktemp` | Make script clean temp dir on error and exit non-zero | `script_tests` (inspect leftovers via `exec`) | basic |
| w4-08-sed | Stream Editor | `sed s///`, `-i`, addresses | Template `config.tpl` → `config.conf` replacing placeholders; delete comment lines | `file_content equals` | basic |
| w4-09-awk | Awk Basics | `awk` fields, patterns, sums | Sum `bytes` column per `user` from log; output sorted | `file_content equals` (seeded) | basic |
| w4-10-xargs-jq | Pipeline Pro | `xargs`, `find -print0`, `jq` | From a JSON file list active users' emails; delete files with spaces in names safely | `file_content`, `exec` | basic |
| w4-11-heredocs-diff | Heredocs & Patches | here-docs, `diff -u`, `patch` | Generate a file via here-doc; create and apply a patch | `file_content sha256`, `exec` | basic |
| w4-12-cron-basics | Cron Basics | `crontab -e`, 5-field syntax | Add entries: every 5 min; 03:00 weekdays; 1st of month 02:30 (and answer: "when does `30 2 1 * *` run?") | `crontab_entry` x3 (semantic), `answer_equals` | admin; cron daemon running |
| w4-13-cron-pitfalls | Cron Doesn't Care | minimal env, absolute paths, redirection, `MAILTO` | Fix a crontab whose job works by hand but fails in cron (relative path, missing PATH, no logs) | `cron_dry_run` + `file_content` log | admin |
| w4-14-systemd-units | Units of Work | `systemctl`, unit files, `journalctl -u` | Write a unit + timer to run `report.sh` daily; start & enable; read its logs | `exec` against shim state | admin; **SPIKE S2** |
| w4-15-logs-logrotate | Logs & Rotation | `/var/log`, `logrotate -d`, `journalctl` | Write a logrotate config (weekly, keep 4, compress); debug run passes | `exec` (`logrotate -d` exit 0 + parse) | admin |
| w4-16-boss-nightly-backup | **Boss: The Nightly Backup** | consolidates W4 | `backup.sh <src> <dst>`: strict mode, usage, timestamped tar.gz, keep newest 7, log to file, lockfile via `flock`; schedule via cron at 02:00; shellcheck clean | `script_tests` (hidden cases), `crontab_entry`, `shellcheck` | admin |

#### World 5 — The War Room (10 levels) — `admin`
| ID | Title | New skills | Player task | Primary checks | Notes |
|---|---|---|---|---|---|
| w5-01-getopts-usage | Real CLI | `getopts`, usage/`--help`, exit codes | Write `mytool` with flags `-v -o FILE -n N`, helpful usage | `script_tests` (hidden) | |
| w5-02-idempotent-flock | Run It Twice | idempotency, `flock`, atomic writes | Script safe to re-run and to run concurrently (two instances) | `script_tests` + `exec` concurrent harness | |
| w5-03-shellcheck-bats | Test Your Shell | `shellcheck`, `bats` | Fix a buggy script flagged by shellcheck; write bats tests that catch 3 hidden buggy variants | `shellcheck_clean` + `exec` (runs player's bats against mutants; must fail on every mutant, pass on original) | the mutants are the "wrong" solutions |
| w5-04-proc-strace-lsof | Under the Hood | `strace`, `lsof`, `/proc` | Find which file a hung process waits on; find deleted-but-open file hogging disk (`lsof +L1`); submit; free the space | `answer_equals`, `exec` df-diff | cap `SYS_PTRACE` |
| w5-05-perf-triage | Who's Slow? | `vmstat`, `iostat`-lite, `top` | 3 seeded processes (CPU/IO/memory hog); identify each and kill the right one | `answer_equals`, `process_absent` | |
| w5-06-network-debug | Packets Don't Lie | `ss`, `tcpdump`, `nc`, `iptables` | A firewall rule blocks port 8080: find & fix so `curl` succeeds; capture a packet proving it | `exec` curl, `answer_equals` | lan, caps `NET_ADMIN`,`NET_RAW` |
| w5-07-ssh-hardening | Lock It Down | `sshd_config`, `find -perm`, audit | Harden sshd config (no root login, key-only), find SUID & world-writable files and fix | `exec` config parse, `file_mode` | lan, `ssh` |
| w5-08-tmux-git-make | Tools of the Trade | `tmux`, `git bisect run`, `make` | Create tmux session, find the bad commit with `git bisect run`, add Makefile target that builds | `exec`, `answer_equals` | |
| w5-09-namespaces-optional | Containers Unboxed | `unshare`, `/proc/self/ns` | *Optional/stretch*: run a command in a new PID namespace and show it sees PID 1 | `exec` | cap `SYS_ADMIN` scoped; **skip if unsafe** |
| w5-10-boss-prod-is-down | **Final Boss: Production is Down** | everything | Multi-stage incident: (1) disk full due to deleted-open log, (2) runaway process, (3) broken cron job, (4) bad service config (use provided `tq-appctl configtest`), (5) brute-force IP block. Then write `postmortem.sh` that prints a summary from a provided incident log | per-stage `exec`/`process_*`/`crontab_entry`, `script_tests` for postmortem | multiple stages, objectives revealed progressively via `tux` messages |

> The agent must author a complete `level.yaml` (+ setup, checks, solution, wrong solutions) for **every row** in the milestone being built. Level *details* not specified in the table (exact file names, seeded values, story text) are the agent's responsibility; follow §8 and §16.

### 11.4 Skill list (starter `skills.yaml` ids)
`echo whoami pwd ls cd paths hidden-files cat mkdir touch cp mv rm rmdir head-tail less man help history tab-completion globs brace-expansion find grep regex-basics recursive-search pipes redirection sort-uniq cut-tr file-types links chmod umask nano vim sudo users-groups chown special-bits ps signals job-control env-vars path bashrc disk-usage tar-zip networking curl dns ssh scp rsync dpkg scripting-basics quoting exit-codes conditionals loops functions strict-mode sed awk xargs jq heredocs diff-patch cron cron-env systemd logrotate getopts flock shellcheck bats strace lsof perf iptables tcpdump ssh-hardening tmux git-bisect make namespaces`. Prereq edges: author sensible ones (e.g. `grep` ← `pipes`? no: `pipes` ← `cat`,`ls`; `cron` ← `scripting-basics`, `chmod`; `cron-env` ← `cron`, `env-vars`).

---

## 12. Level Tooling & Content Tests

### 12.1 Level loader (`engine/levelLoader.ts`)
Loads all `level.yaml` at server start, validates with zod, builds indexes: by id, by world, ordered lists, skills map. Fail startup with a clear error listing all problems.

### 12.2 Setup compiler (`engine/setupCompiler.ts`)
Turns `setup` into: (1) a list of tar entries for `putFiles` (files, `content_file`, `checks/*` into `/opt/tq/checks/<levelId>/`, generator scripts into `/opt/tq/gen/`); (2) a root-run script executed with `bash -e`: create dirs → set owners/modes → run generators (`TQ_SEED`) → run `commands` → write `rc_extra` to `/home/player/.bashrc` (create if missing; chown player) → create `/run/tq/{cmdlog,inbox}` (0622) and `/opt/tq/secret` → start cron if profile `admin` and level declares `needs_cron: true` (default true for admin).

### 12.3 `levels:lint` rules (beyond schema)
- `id` matches directory; `order` unique and contiguous within a world.
- Exactly 3 hints; story ≤ 80 words; ≤ 4 non-bonus objectives (bosses ≤ 8); ≥1 non-optional objective.
- Every `teaches` skill exists; every `exec.script`/`content_file`/generator path exists.
- Every level has `solutions.reference`; boss levels have ≥ 1 `wrong` solution.
- No check references answers in `setup.files.content` plaintext when `seeded` generators exist (answers must come from `secret`).
- `levels:lint` must run in < 5 s for the whole content tree.

### 12.4 `levels:test` (the content test harness, `tools/level-runner`)
For each level (and for 3 seeds each):
1. Start sandbox via `DockerProvider` + same setup path as production.
2. **Baseline:** run nothing; evaluate all objectives → required objectives must **not** all pass (guards vacuous checks).
3. **Wrong solutions:** run each `wrong/*.sh` as `player` (`bash -l`, with cmdlog active, `tux submit` supported as a shell function writing to inbox) → level must **not** complete.
4. **Reference solution:** run `solution.sh` → all required objectives pass; bonus objectives are reported.
5. Teardown. Print a table; exit non-zero on any failure.
Reference solutions can use `tux submit "$(…)"` to answer; because `tux` reads secrets only through the player-visible path, solutions must *derive* answers from visible data (e.g. `ls`, `grep`), proving the level is solvable by a player.
Run time budget: whole W1+W2 suite < 10 min on CI (parallelize up to 4 containers).

---

## 13. Security Checklist (must all be satisfied before any public deployment)
- [ ] Containers: caps dropped, resource limits set, `no-new-privileges` for `basic`, network `none` by default, no host mounts, no docker socket inside.
- [ ] `lan` networks are `Internal: true` (no internet egress) and per-attempt.
- [ ] The server process controls Docker → it is root-equivalent on the host. Production: run Docker **rootless** or on a dedicated VM; run the server as a non-root user in the `docker` group of that VM only. Never expose the Docker socket over TCP.
- [ ] Secrets/answers/checks are never sent to the client. `GET /api/levels/:id` returns a whitelisted DTO only (use an explicit `toPublicLevel`).
- [ ] WebSocket auth: session must belong to cookie user; validate Origin header against `PUBLIC_ORIGIN`.
- [ ] Input limits (stdin rate, frame size), one session per user, per-IP and per-user rate limits.
- [ ] Reaper guarantees cleanup; boot-time orphan sweep.
- [ ] Checks run with fixed PATH/env as root and time limits; check scripts are root-owned and not writable by player.
- [ ] Logging excludes terminal contents (log only commands in `events` payloads truncated to 200 chars, and only if `LOG_COMMANDS=1`).
- [ ] CSP header on web (default-src 'self'; connect-src 'self' ws:/wss: same host), no external scripts/fonts.
- [ ] Known/accepted limitation: players with `admin` sudo could tamper with system binaries; leaderboards are out of MVP scope for this reason.

---

## 14. Configuration & Deployment

### 14.1 Environment variables (`config.ts`, zod-validated, defaults in parentheses)
```
PORT (3001)               PUBLIC_ORIGIN (http://localhost:5173)
DB_PATH (./data/tq.sqlite)
DOCKER_SOCKET (/var/run/docker.sock)
SANDBOX_IMAGE (tq-base)   SANDBOX_RUNTIME ()         # e.g. runsc
MAX_CONTAINERS (20)       IDLE_TTL_SECONDS (900)     MAX_AGE_SECONDS (3600)
UNLOCK_ALL (0)            ENABLE_WORLDS (1,2)        # comma list; gate content as it is completed
LOG_LEVEL (info)          LOG_COMMANDS (0)
```
### 14.2 Dev
`pnpm i && pnpm images:build && pnpm db:migrate && pnpm dev` → web at :5173 (Vite proxies `/api` and `/ws` to :3001).
### 14.3 Prod (single VM)
Server serves the built web via `@fastify/static` on one port behind a TLS-terminating reverse proxy (Caddy recommended). systemd unit for the server, rootless Docker for sandboxes, nightly SQLite backup (`sqlite3 .backup`).
### 14.4 CI (`.github/workflows/ci.yml`)
Jobs: (1) `verify` (build, lint, unit tests) (2) `levels` (build images, `levels:lint`, `levels:test --world 1,2` with Docker available on the runner) (3) `e2e` (Playwright smoke, §15 M5). Cache pnpm store and Docker layers.

---

## 15. Milestones & Tasks (execute in order)

Each task: **do** → **acceptance** (verify before ticking in `PROGRESS.md`).

### M0 — Scaffold
- **T0.1** Create monorepo per §3 with pnpm workspaces, strict TS, ESLint, Prettier, vitest; empty app skeletons that build. *Accept:* `pnpm i && pnpm verify` passes; `pnpm dev` serves a "hello" page and server `/healthz` returns `{ok:true,docker:<bool>}`.
- **T0.2** `packages/shared` with zod schemas for protocol (§6.1) and the full level schema (§8.1) + check union (§8.2). *Accept:* unit tests parse a valid example level and reject an invalid one (missing hints, wrong check type).
- **T0.3** DB schema + migrations (§5), `db/client.ts`. *Accept:* `pnpm db:migrate` creates tables; a test inserts/reads a user.
- **T0.4** CI workflow. *Accept:* workflow file valid; `verify` job defined.

### M1 — Sandbox
- **T1.1** `packages/sandbox-images/base`: Dockerfile + `/opt/tq/*` scripts (§7.1, 7.4, 7.5). *Accept:* `pnpm images:build` produces `tq-base`; `docker run --rm tq-base bash -lc 'whoami; ls /opt/tq/bin'` prints `player`/files (default user player).
- **T1.2** `DockerProvider` implementing §7.2 (create, putFiles via tar, exec with timeout, openShell, watchFile, destroy, listManaged) + security profiles (§7.3). *Accept (integration test, requires Docker):* create `basic` sandbox, `exec id` returns uid 1000 for player; network none verified (`curl` fails); memory limit label present; `destroy` leaves no container; interactive shell echoes typed `echo hi\n`.
- **T1.3** `SessionManager` + `reaper` (idle/max-age/orphans, capacity cap). *Accept:* tests with fake clock show idle expiry destroys sandbox; orphan sweep removes labelled containers.

### M2 — Level engine
- **T2.1** `levelLoader` + `levels:lint` (§12.1, 12.3). *Accept:* lint passes on a sample level and fails (with clear messages) on malformed ones.
- **T2.2** `setupCompiler` (§12.2) and running setup in a sandbox. *Accept:* sample level with seeded generator yields different answers for different seeds; `/run/tq/cmdlog` writable; `/opt/tq/secret` not readable by player.
- **T2.3** Check implementations §8.2 (all types except `script_tests`, `cron*`, `crontab_entry` which come in T2.5) with unit tests against real sandbox. *Accept:* each check type has a passing and failing test.
- **T2.4** `ObjectiveTracker`, cmdlog parser, `tux` inbox handling, scoring (§10.1), hints (§10.6), coach (§10.7). *Accept:* unit tests for XP/rank math across scenarios, coach rate-limiting, command counting rules.
- **T2.5** `script_tests`, `crontab_entry`, `cron_dry_run`, `login_shell_eval` checks (§8.2–8.3) + `cronmatch.py`. *Accept:* tests for crontab semantic matching (`*/5 * * * *` ≡ `0,5,10,… * * * *`) and cron-like env dry-run failing on relative paths.
- **T2.6** `tools/level-runner` (§12.4). *Accept:* running it on the sample level reports baseline-fail / wrong-fail / reference-pass.

### M3 — Server API & socket
- **T3.1** Auth (guest cookie), `me`, `worlds`, `levels/:id` (public DTO), unlock logic. *Accept:* API tests: unlock progression, DTO contains no `check` or `hints`, rate limits.
- **T3.2** `start`, `reset`, `DELETE session`, WebSocket (§6.1) wiring session ↔ shell ↔ tracker. *Accept:* Node test client connects, sends `stdin` for a sample level's solution, receives `objective` and `level_complete`; ownership & origin checks enforced; single-session-per-user.
- **T3.3** Persistence of attempts, level progress, skills, XP, badges, streaks, spellbook, daily, review endpoints (§10). *Accept:* tests for each progression rule incl. repeat completion XP improvement logic.

### M4 — Web client
- **T4.1** Theme, routing, API client, state stores, Landing + WorldMap. *Accept:* guest creation flow works; map shows locked/available states from API.
- **T4.2** Level page: `TerminalView`, `QuestPanel`, objective list, hints, tux bubble, reset/leave, reconnect, `CompleteModal`. *Accept:* manual check in browser: typing works (colors, Ctrl+C, tab completion), resize works, objective ticks live.
- **T4.3** Spellbook, Skills graph, Profile, Settings, `MobileKeyBar`, a11y live region. *Accept:* pages render with API data; Lighthouse accessibility ≥ 90 on Level and Map pages.

### M5 — Vertical slice (**gate**: do not proceed until green)
- **T5.1** Author levels `w1-01`, `w1-02`, `w1-03` completely. *Accept:* `pnpm levels:test --world 1` passes for these.
- **T5.2** Playwright e2e `e2e/smoke.spec.ts`: open site → Start playing → open w1-01 → type `echo hello` + `whoami` into xterm → see objectives complete → completion modal → next level unlocked on map. *Accept:* `pnpm e2e` passes locally and in CI.

### M6 — Progression & polish
- **T6.1** Badges, streak, daily, review endpoints + UI surfaces (map streak flame, daily card, review banner). *Accept:* unit tests; UI shows daily card.
- **T6.2** Tux dialogue system: level intro, completion messages, idle nudge (§10.6). *Accept:* tests for nudge conditions; no auto-reveal of hints.
- **T6.3** Telemetry events (§5 `events`) emitted at all listed points. *Accept:* test asserts events recorded for a full attempt.

### M7 — Content: World 1 (all 12 levels, §11.3)
*Accept:* `levels:lint` and `levels:test --world 1` green with 3 seeds; each level playable in the browser; average estimated time W1 ≤ 90 min total.

### M8 — Content: World 2 (all 15 levels)
*Accept:* same bar as M7 for World 2; `ENABLE_WORLDS=1,2` is the **MVP release configuration**.

### M9 — Hardening & deploy
- **T9.1** Walk the §13 checklist; add tests where feasible (origin check, ownership, DTO whitelist, rate limits). *Accept:* all boxes ticked or explicitly waived in `DECISIONS.md`.
- **T9.2** Load test: 20 concurrent sessions on a 4-vCPU box with MAX_CONTAINERS=20; confirm 21st gets 429 and reaper keeps memory stable. *Accept:* short report in `docs/loadtest.md`.
- **T9.3** Deploy docs (`docs/deploy.md`): rootless Docker, systemd unit, Caddyfile, backups. *Accept:* doc is followable end to end.

### M10 — Infra for Worlds 3–5 and content
- **T10.1** `admin` profile polish (sudo allow-list, cron daemon start, capabilities mapping). *Accept:* `w3-01` passes `levels:test`.
- **T10.2** Sidecars + `lan` network (§7.7). *Accept:* `w3-10`/`w3-11`/`w3-12` pass; no internet egress verified from player container.
- **T10.3 SPIKE S1 (cron timing):** try accelerated time for real cron with `libfaketime` so scheduled jobs actually fire during a level. *Fallback (default):* rely on `crontab_entry` semantic match + `cron_dry_run`, and add a Tux "simulate next 5 runs" output via `cronmatch.py` for feedback. Record result in `DECISIONS.md`.
- **T10.4 SPIKE S2 (systemd):** real systemd in an unprivileged container is not viable. *Default:* implement a small `systemctl`/`journalctl` **shim** (python, in `/opt/tq/bin`) supporting `start|stop|restart|status|enable|disable|daemon-reload|list-timers`, `[Service] Type=simple, ExecStart, User, Restart=on-failure`, `[Timer] OnCalendar` (subset: `daily`, `hourly`, `*-*-* HH:MM:SS`), unit files in `/etc/systemd/system`, logs to `/var/log/tq-journal/<unit>.log`. Mark `w4-14` as `requires: systemd-shim` and document divergences from real systemd on the level page ("In this sandbox, systemd is simulated.").
- **T10.5** Author World 3 (15), World 4 (16), World 5 (10; `w5-09` optional) levels. Each batch is done only when `levels:lint` + `levels:test` are green for that world. *Accept:* enabling `ENABLE_WORLDS=1,2,3,4,5` shows a fully playable game.
- **T10.6** Optional: GitHub OAuth login to convert guest → account (merge progress), classroom mode. Out of MVP scope; only start after T10.5.

---

## 16. Content Authoring Guide

### 16.1 Tux-9000 voice
Dry, short sentences, grumpy but caring; never mocks the player; celebrates quietly; occasional penguin/Linux puns (max 1 per level). Examples:
- Intro: "New hire. Good. Don't touch anything yet. Okay, touch the keyboard."
- Success: "Correct. I'd say 'nice job' but I'm contractually limited to 'acceptable.'"
- Hint offer: "Stuck? There's no shame in a hint. There's a small XP tax."
- Failure nudge: "That command exited non-zero. Which is Linux for 'no.'"

### 16.2 Level design rules
1. One mission, one story beat, ≤ 80 words of story. Explain *why* the task matters.
2. ≤ 2 new ideas per level; recap older skills via the seeded data, not text.
3. 1–4 required objectives (bosses up to 8). Objective text is imperative, specific, verifiable.
4. Check **outcomes**, not command spelling. `command_used` is for teaching beats only ("you must use man/--help" is bonus, never required).
5. Provide at least two valid solution paths when natural; the reference solution should be the "expected pro" path, and the wrong solutions should be natural mistakes (typos aside).
6. Randomize any value a player could look up online (answers, file counts) with generators.
7. Make destruction safe: placing "important" files that must survive (`hold: true`) teaches caution.
8. Three hints: nudge (concept), hint (command/flag name), near-solution (full command with a placeholder or the pattern).
9. `explain` cards cover every non-trivial command in the reference solution; `cheatsheet` entries feed the spellbook.
10. Time target 3–10 minutes per level (bosses ≤ 20).
11. Never require typing more than ~120 characters in one command.

### 16.3 Worked example (copy this style)
`packages/levels/content/w1/02-where-am-i/level.yaml`
```yaml
id: w1-02-where-am-i
world: 1
order: 2
title: "Where Am I?"
kind: lesson
difficulty: 1
estimated_minutes: 4
story: |
  Tux-9000: "You're lost. Everyone is, at first. Two commands will fix that:
  one tells you where you are, the other tells you what's around you.
  A welcome file is waiting in your home folder. Its name hides a secret word."
teaches: [pwd, ls]
par_commands: 3
xp: 50
sandbox: { profile: basic, network: none, start_cwd: /home/player }
setup:
  generators:
    - { script: setup/gen.sh }
objectives:
  - id: ran-pwd
    text: "Run pwd to see which directory you're in."
    check: { type: command_used, regex: '^pwd$' }
  - id: ran-ls
    text: "Run ls to list what's in this directory."
    check: { type: command_used, regex: '^ls(\s|$)' }
  - id: found-word
    text: "Find the welcome file and submit the word in its name: tux submit <word>"
    check: { type: answer_equals, from_file: /opt/tq/secret/welcome_word }
hints:
  - "ls lists files. Look for one starting with 'welcome-'."
  - "The word is between 'welcome-' and '.txt'."
  - "If the file is 'welcome-banana.txt', type: tux submit banana"
explain:
  - command: "pwd"
    parts: [ { token: "pwd", meaning: "print working directory — where you are right now" } ]
  - command: "ls"
    parts: [ { token: "ls", meaning: "list directory contents" } ]
cheatsheet:
  - { skill: pwd, syntax: "pwd", note: "Show the full path of the current directory." }
  - { skill: ls,  syntax: "ls [-la] [PATH]", note: "List files. -l long format, -a include hidden files." }
success_message: "Located. You now know where you are and what's around you. That's 80% of Linux."
solutions: { reference: solution.sh, wrong: [wrong/wrong-word.sh] }
```
`setup/gen.sh`
```bash
#!/bin/bash
set -e
WORDS=(banana walrus copper lantern otter pebble marlin quartz saffron tundra)
RANDOM=$TQ_SEED
w=${WORDS[$((RANDOM % ${#WORDS[@]}))]}
mkdir -p /opt/tq/secret
printf '%s' "$w" > /opt/tq/secret/welcome_word
chmod 600 /opt/tq/secret/welcome_word
printf 'Welcome to Penguin Corp!\n' > "/home/player/welcome-$w.txt"
for f in memo-1.txt notes.txt todo.txt; do echo "$f" > "/home/player/$f"; done
chown player:player /home/player/*
```
`solution.sh`
```bash
pwd
ls
f=$(ls welcome-*.txt); w=${f#welcome-}; w=${w%.txt}
tux submit "$w"
```
`wrong/wrong-word.sh`
```bash
pwd
ls
tux submit "welcome"
```

---

## 17. Quality Bar & Final Acceptance

The project is **MVP-complete** when:
1. `pnpm verify`, `pnpm levels:lint`, `pnpm levels:test --world 1,2`, and `pnpm e2e` all pass in CI.
2. A new visitor can open the site, click Start, and finish `w1-01` in < 3 minutes with no outside help.
3. All 27 W1+W2 levels are playable, seeded, hinted, and have passing reference + wrong-solution tests.
4. §13 security checklist is complete (or waivers documented).
5. `PROGRESS.md` shows every M0–M9 task ticked, with known gaps listed.

The project is **feature-complete** when M10 is done and `ENABLE_WORLDS=1,2,3,4,5` runs all ~68 levels green in `levels:test`.
