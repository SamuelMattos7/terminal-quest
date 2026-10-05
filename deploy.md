# Deploying Terminal Quest (single VM)

> **Status: DRAFT.** Written from the plan; it has **not** been verified on a clean machine. Task T9.3 is complete only when someone follows this document end to end on a fresh VM and fixes every wrong step. Record corrections in the "Verification log" at the bottom.

## 1. Overview

One VM runs:
- **Caddy** (TLS, reverse proxy) → public `:443`
- **Terminal Quest server** (Node 22; serves the built web app, REST API, WebSocket) on `127.0.0.1:3001`
- **Rootless Docker** (sandbox containers for players) running under a dedicated unprivileged user
- **SQLite** database file with nightly backups

Why rootless Docker: the server controls Docker, which is otherwise root-equivalent on the host. Rootless limits the blast radius of a sandbox escape to an unprivileged user.

## 2. Requirements

- Debian 12 or Ubuntu 22.04/24.04, 4 vCPU / 8 GB RAM minimum for ~20 concurrent sandboxes (see `docs/loadtest.md`)
- A DNS name pointing to the VM (e.g. `quest.example.com`)
- Ports 80 and 443 open; nothing else needed publicly
- cgroup v2 (default on the OSes above)

## 3. Create the service user

```bash
sudo adduser --disabled-password --gecos "" tq
sudo loginctl enable-linger tq          # lets the user's services run without a login session
```

## 4. Install rootless Docker for `tq`

```bash
sudo apt-get update
sudo apt-get install -y uidmap dbus-user-session slirp4netns fuse-overlayfs curl ca-certificates
# Install Docker Engine packages per https://docs.docker.com/engine/install/ (docker-ce, docker-ce-cli, containerd.io, docker-ce-rootless-extras)
sudo systemctl disable --now docker.service docker.socket   # stop the rootful daemon
sudo -iu tq dockerd-rootless-setuptool.sh install
```

Enable cgroup v2 delegation so memory/CPU/PID limits work in rootless mode:
```bash
sudo mkdir -p /etc/systemd/system/user@.service.d
sudo tee /etc/systemd/system/user@.service.d/delegate.conf >/dev/null <<'EOF'
[Service]
Delegate=cpu cpuset io memory pids
EOF
sudo systemctl daemon-reload
sudo systemctl restart user@$(id -u tq).service
```

Verify as `tq` (use `sudo -iu tq`):
```bash
export XDG_RUNTIME_DIR=/run/user/$(id -u)
systemctl --user enable --now docker
docker info | grep -Ei 'rootless|cgroup'
docker run --rm --memory 64m --pids-limit 32 alpine sh -c 'echo ok'
```
The socket will be at `/run/user/<tq-uid>/docker.sock` — you'll use this as `DOCKER_SOCKET`.

> Rootless caveats: some capabilities (e.g. `NET_ADMIN` in sandboxes for World 5) work only inside the user namespace; level tests in CI should run the same way the production host does. Ports below 1024 aren't needed for sandboxes.

## 5. Install Node and build the app

```bash
sudo -iu tq
# Node 22 LTS via nvm or distro packages
git clone <your repo URL> ~/terminal-quest && cd ~/terminal-quest
corepack enable && pnpm i --frozen-lockfile
pnpm build
pnpm images:build            # builds tq-base and sidecar images into the rootless daemon
pnpm db:migrate
```

## 6. Configure

Create `~/terminal-quest/.env.production`:
```
PORT=3001
PUBLIC_ORIGIN=https://quest.example.com
DB_PATH=/home/tq/data/tq.sqlite
DOCKER_SOCKET=/run/user/<tq-uid>/docker.sock
SANDBOX_IMAGE=tq-base
MAX_CONTAINERS=20
IDLE_TTL_SECONDS=900
MAX_AGE_SECONDS=3600
ENABLE_WORLDS=1,2
UNLOCK_ALL=0
LOG_LEVEL=info
LOG_COMMANDS=0
```
`mkdir -p ~/data`. Replace `<tq-uid>` with the output of `id -u tq`. Never set `UNLOCK_ALL=1` in production.

## 7. Run the server as a systemd user service

`/home/tq/.config/systemd/user/terminal-quest.service`:
```ini
[Unit]
Description=Terminal Quest server
After=docker.service
Requires=docker.service

[Service]
WorkingDirectory=%h/terminal-quest
EnvironmentFile=%h/terminal-quest/.env.production
ExecStart=/usr/bin/node apps/server/dist/index.js
Restart=on-failure
RestartSec=3
NoNewPrivileges=true

[Install]
WantedBy=default.target
```
Enable:
```bash
export XDG_RUNTIME_DIR=/run/user/$(id -u)
systemctl --user daemon-reload
systemctl --user enable --now terminal-quest
journalctl --user -u terminal-quest -f
curl -s http://127.0.0.1:3001/healthz     # expect {"ok":true,"docker":true}
```
(Adjust the `node` path if you installed it elsewhere: `command -v node`.)

## 8. Caddy (TLS + reverse proxy)

Install Caddy from its official apt repo, then `/etc/caddy/Caddyfile`:
```
quest.example.com {
    encode zstd gzip
    header {
        Strict-Transport-Security "max-age=31536000"
        X-Content-Type-Options "nosniff"
        Referrer-Policy "no-referrer"
    }
    reverse_proxy 127.0.0.1:3001
}
```
```bash
sudo systemctl reload caddy
```
Caddy proxies WebSockets automatically. The server sets the Content-Security-Policy header itself (see `plan.md §13`).

## 9. Backups

Nightly SQLite backup (as `tq`), via a user timer or cron:
```bash
# ~/bin/tq-backup.sh
#!/usr/bin/env bash
set -euo pipefail
mkdir -p "$HOME/backups"
sqlite3 "$HOME/data/tq.sqlite" ".backup '$HOME/backups/tq-$(date +%F).sqlite'"
find "$HOME/backups" -name 'tq-*.sqlite' -mtime +14 -delete
```
```
0 3 * * *  /home/tq/bin/tq-backup.sh
```
Copy backups off the VM (rsync/object storage) — a backup on the same disk is not a backup.

## 10. Upgrades

```bash
sudo -iu tq && cd ~/terminal-quest
git pull
pnpm i --frozen-lockfile && pnpm build
pnpm images:build           # only needed if sandbox images changed
pnpm db:migrate
systemctl --user restart terminal-quest
```
Active sessions end on restart (clients see a `closing` message). The orphan sweep at boot removes leftover sandboxes.

## 11. Operations checklist

- `docker ps --filter label=tq.managed=true` — live sandboxes. Count should never exceed `MAX_CONTAINERS`.
- Cleanup stray sandboxes manually: `docker rm -f $(docker ps -aq --filter label=tq.managed=true)`
- Disk: `docker system df`; prune dangling layers monthly.
- Logs: `journalctl --user -u terminal-quest --since "1 hour ago"`.
- Updates: apply OS security updates regularly; rebuild `tq-base` periodically to pick up Debian security fixes.

## 12. Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| `/healthz` shows `docker:false` | Wrong `DOCKER_SOCKET`; docker user service not running (`systemctl --user status docker`); `XDG_RUNTIME_DIR` unset |
| Start level returns 429 | `MAX_CONTAINERS` reached; check stuck sandboxes; reaper logs |
| Resource limits ignored | cgroup v2 delegation not applied (step 4) |
| Terminal connects then closes immediately | Origin mismatch: `PUBLIC_ORIGIN` must equal the browser origin exactly |
| `sudo` fails inside `basic` levels | Expected: `no-new-privileges` is set for the basic profile |
| Sandbox can't resolve `*.penguin.corp` | Level needs `lan` network + `dns` sidecar; check sidecar image exists |

## Verification log
_Record each time this doc was followed on a clean machine, with corrections._

| Date | OS | Result | Corrections made |
|---|---|---|---|
| — | — | not yet verified | — |
