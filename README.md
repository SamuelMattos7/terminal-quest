# 🐧 Terminal Quest
 
**Learn the Linux command line by playing.** Type real commands in a real (sandboxed) shell, right in your browser, and complete story missions that take you from `ls` to cron jobs, shell scripts, and putting out a production fire.
 
> **Status: pre-alpha, in active development.** Worlds 1 and 2 are playable. Deployment validation is the next milestone. See [`plan.md`](plan.md) for the specification and [`PROGRESS.md`](PROGRESS.md) for implementation progress.
 
---
 
## What is it?
 
You're the new hire at **Penguin Corp**. Your mentor, the grumpy-but-caring **Tux-9000**, hands you missions that start with "find my lost file" and end with "production is down, fix it."
 
- 🖥️ **A real shell, not a simulation.** Every attempt gets its own isolated Linux container.
- ✅ **Outcome-based checking.** The game inspects the resulting system state (files, permissions, processes, ports, crontabs), so any valid solution works.
- 🎲 **Randomized levels.** Answers change per attempt, so copy-pasting solutions from the internet doesn't work.
- 💡 **Tiered hints.** Nudge → hint → near-solution, each with a small XP cost.
- 🏆 **Progression.** XP, ranks (S/A/B/C), player levels, a skill tree, a personal "spellbook" cheat sheet, badges, streaks, and daily challenges.
- 📈 **Noob to pro.** The planned curriculum spans five worlds, each with a boss fight.
## The curriculum
 
| World | Tier | You'll learn | Boss |
|---|---|---|---|
| 1. The Lobby | 🌱 Noob | Navigation, files & directories, reading files, `man`, history | Organize the Chaos |
| 2. The Filing Room | 🔧 Apprentice | Globs, `find`, `grep`, pipes, redirection, permissions, `nano`, `vim` | The Log Detective |
| 3. The Engine Room | ⚙️ Practitioner | Users, processes & signals, env vars, disk, archives, networking, `ssh`, `rsync` | Server Setup |
| 4. The Automation Lab | 🛠️ Engineer | Shell scripting, `sed`, `awk`, `jq`, **cron**, systemd, logs | The Nightly Backup |
| 5. The War Room | 🧙 Pro | `getopts`, idempotency & `flock`, `shellcheck`/`bats`, `strace`, `lsof`, `tcpdump`, hardening, `git bisect` | Production is Down |
 
## How it works
 
```
Browser (React + xterm.js)
   │  REST            │  WebSocket (terminal I/O + live objective updates)
   ▼                  ▼
Fastify server ── Session manager ── Docker (one sandbox per attempt)
   │                   │
   │                   └─ Level engine: setup → live checks → hints → scoring
   └─ SQLite (progress, XP, skills, badges)
```
 
Levels are plain YAML files plus a reference solution, so adding content doesn't require touching engine code. CI tests all 27 levels in Worlds 1 and 2 across three seeds. For each seed, the baseline and known-wrong attempts must stay incomplete and the reference solution must pass.
 
## Quick start (development)
 
**Requirements:** Node.js 22+, [pnpm](https://pnpm.io), Docker (Engine or Docker Desktop).
 
```bash
git clone <your-repo-url> terminal-quest
cd terminal-quest
pnpm i
pnpm images:build     # build the tq-base sandbox image
pnpm db:migrate       # create the SQLite database
pnpm dev              # web on http://localhost:5173, API on :3001
```
 
Useful commands:
 
```bash
pnpm verify           # build + lint + unit tests
pnpm levels:lint      # validate all level definitions
pnpm levels:test      # run level solutions inside Docker (flags: --world 1 --level <id> --seeds 3)
pnpm e2e              # Playwright smoke test
```
 
For local testing you can set `UNLOCK_ALL=1` to unlock every level. Never use it in production.
 
## Project layout
 
```
apps/server             API, WebSocket, sandbox manager, level engine
apps/web                React client with the terminal UI
packages/shared         Shared zod schemas and types
packages/levels         All game content (levels, skills, badges, coach rules)
packages/sandbox-images Dockerfile and helpers for the player sandbox
tools/level-runner      Lint and test harness for levels
deploy.md, loadtest.md  Deployment guide and load-test template
```
 
## Documentation
 
| Doc | Purpose |
|---|---|
| [`plan.md`](plan.md) | Full build specification: architecture, schemas, API, curriculum, milestones |
| [`AGENTS.md`](AGENTS.md) | Working instructions for AI coding agents (and a good contributor primer) |
| [`PROGRESS.md`](PROGRESS.md) | Build status and level-by-level tracker |
| [`DECISIONS.md`](DECISIONS.md) | Architecture decision log |
| [`deploy.md`](deploy.md) | Deploying to a single VM (draft, pending verification) |
| [`loadtest.md`](loadtest.md) | Load test procedure and results (template until the test is run) |
 
## Contributing
 
Contributions are welcome, especially **new levels**.
 
1. Read [`AGENTS.md`](AGENTS.md), including the level authoring checklist in §8 and the style guide in `plan.md` §16.
2. Create `packages/levels/content/w<N>/<NN>-<slug>/` with `level.yaml`, `solution.sh`, at least one `wrong/*.sh`, and any setup files.
3. Run `pnpm levels:lint` and `pnpm levels:test --level <id> --seeds 3`.
4. Open a PR using [Conventional Commits](https://www.conventionalcommits.org/) (`feat(levels): add w2-05-grep-basics`).
Good level rules of thumb: one mission, one story beat, at most two new ideas, check outcomes rather than exact commands, and always give three hints.
 
## Security notes
 
Players run arbitrary commands, so sandboxing matters:
 
- Containers drop all capabilities, have CPU/memory/PID limits, and run with **no network**. Per-attempt LANs and sidecars are planned for T10.2.
- Check logic and answers never reach the client.
- For production, run Docker **rootless** or on a dedicated VM. See [`deploy.md`](deploy.md) and the checklist in `plan.md` §13.
- Found a vulnerability? Please report it privately (add a `SECURITY.md` with contact details before going public).
