# Deploying Terminal Quest (single VM)

> **Status: DRAFT.** Reviewed against the current repository. Clean-VM verification is pending under T9.3. Record the outcome and any corrections in the verification log.

## 1. Overview

The VM runs these services.

- **Caddy** (TLS, reverse proxy) → public `:443`
- **Terminal Quest server** on `127.0.0.1:3001`. Node 24 matches CI and serves the built web app, REST API, and WebSocket.
- **Rootless Docker** (sandbox containers for players) running under a dedicated unprivileged user
- **SQLite** database file with nightly backups

The server controls Docker. Running Docker as an unprivileged user limits the host privileges available to the daemon and sandboxes.

## 2. Requirements

- Debian 12 or Ubuntu 22.04/24.04 and cgroup v2. The 4 vCPU / 8 GB target for 20 concurrent sandboxes is pending measurement in T9.2. [Load test procedure](loadtest.md)
- A DNS name pointing to the VM (e.g. `quest.example.com`)
- Ports 80 and 443 open; nothing else needed publicly

## 3. Create the service user

```bash
sudo adduser --disabled-password --gecos "" tq
sudo loginctl enable-linger tq          # lets the user's services run without a login session
```

## 4. Install rootless Docker for `tq`

```bash
sudo apt-get update
sudo apt-get install -y uidmap dbus-user-session slirp4netns fuse-overlayfs curl ca-certificates git sqlite3
# Install Docker Engine packages per https://docs.docker.com/engine/install/ (docker-ce, docker-ce-cli, containerd.io, docker-ce-rootless-extras)
sudo systemctl disable --now docker.service docker.socket   # stop the rootful daemon
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

Enter a login shell with `sudo -iu tq`, then install and verify rootless Docker:
```bash
export XDG_RUNTIME_DIR=/run/user/$(id -u)
export DBUS_SESSION_BUS_ADDRESS="unix:path=$XDG_RUNTIME_DIR/bus"
dockerd-rootless-setuptool.sh install
systemctl --user enable --now docker
docker context use rootless
docker info | grep -Ei 'rootless|cgroup'
docker run --rm --cpus 0.5 --memory 64m --pids-limit 32 alpine sh -c 'echo ok'
```
The socket will be at `/run/user/<tq-uid>/docker.sock` — you'll use this as `DOCKER_SOCKET`.

Confirm the security options list `rootless`, the cgroup version is 2, and Docker reports no warnings about missing CPU, memory, or PID limits. Keep the rootless context selected for image builds and operations. [Docker rootless setup](https://docs.docker.com/engine/security/rootless/) · [Resource limits](https://docs.docker.com/engine/security/rootless/tips/#limiting-resources)

## 5. Install Node and build the app

Install Node 24 and pnpm 9.15.9 and make both available in the `tq` shell.
Set `repo_url` to the Git clone URL for the repository.

```bash
git clone "$repo_url" ~/terminal-quest && cd ~/terminal-quest
pnpm i --frozen-lockfile
pnpm build
pnpm images:build            # builds tq-base in the rootless daemon
```

The image build covers the base sandbox. LAN networks and sidecars are scheduled for T10.2.

## 6. Configure and migrate

Create `~/terminal-quest/.env.production` with simple shell-compatible assignments so both systemd and the migration command can read it.
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
```
Replace `<tq-uid>` with the output of `id -u tq`. The MVP enables Worlds 1
and 2. Keep `UNLOCK_ALL=0` in production.

From the checkout as `tq`, run the migration before starting the service:

```bash
(set -a && . ./.env.production && pnpm db:migrate)
```

The migrator creates the parent directory and logs the database path. Confirm
it reports `/home/tq/data/tq.sqlite`, the same path the service will open.
The compiled server does not load `.env.production` itself. The systemd
`EnvironmentFile` supplies its settings.

## 7. Run the server as a systemd user service

As `tq`, create `~/.config/systemd/user` and save this as `terminal-quest.service`.

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
export DBUS_SESSION_BUS_ADDRESS="unix:path=$XDG_RUNTIME_DIR/bus"
systemctl --user daemon-reload
systemctl --user enable --now terminal-quest
journalctl --user -u terminal-quest -n 30 --no-pager
curl -s http://127.0.0.1:3001/healthz     # expect {"ok":true,"docker":true}
```
Set `ExecStart` to the absolute Node path reported by `command -v node` in the `tq` shell if it differs from the example. HTTP 200 indicates app liveness. Confirm `docker:true` before starting a level.

The compiled entry point (`node apps/server/dist/index.js`) serves `apps/web/dist/index.html`
and the built `/assets/*` files on the same port as the API and WebSocket. Build both
packages with `pnpm build` before starting or restarting the service, and keep the
repository layout when deploying. Asset paths resolve relative to the installed
server module, independently of the working directory. Startup fails with a
`run pnpm build` message if the web index is missing. Development (`pnpm dev`)
continues to use Vite on port 5173.

Check delivery before configuring Caddy:
```bash
curl -I http://127.0.0.1:3001/          # 200, text/html
curl -I http://127.0.0.1:3001/map       # 200, SPA refresh
curl -I http://127.0.0.1:3001/assets/missing.js  # 404, never index.html
```
The HTML uses `max-age=0` so navigations revalidate after upgrades. Unknown
`/api`, `/ws`, and `/healthz` paths keep their normal JSON/auth errors;
non-GET/HEAD requests and missing file paths never use the SPA fallback.
`pnpm verify` includes Docker-free regressions that start the actual compiled
server from another working directory and fetch the emitted HTML, JS, CSS, and
self-hosted font bytes, plus API and WebSocket authorization checks. Clean-VM deployment verification remains part of T9.3.

## 8. Caddy (TLS + reverse proxy)

Return to the administrator shell and install Caddy from its official apt
repository. Save the following as `/etc/caddy/Caddyfile` with your public domain.

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
sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
sudo systemctl reload caddy
```
Caddy proxies WebSockets automatically. Keep Caddy on the same host and point it
at `127.0.0.1`. The compiled server listens on that address and uses the
immediate client IP forwarded by Caddy for rate limits. Set `PUBLIC_ORIGIN` to
the external HTTPS origin. The compiled server always marks guest cookies
`Secure`, and its Content-Security-Policy allows same-origin assets and the
WebSocket at that public origin. [Caddy reverse proxy reference](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy)

## 9. Backups

Run a nightly backup as `tq` via a user timer or cron. The script reads
`DB_PATH` from the deployment environment file.
```bash
# ~/bin/tq-backup.sh
#!/usr/bin/env bash
set -euo pipefail
. "$HOME/terminal-quest/.env.production"
mkdir -p "$HOME/backups"
sqlite3 "$DB_PATH" ".backup '$HOME/backups/tq-$(date +%F).sqlite'"
find "$HOME/backups" -name 'tq-*.sqlite' -mtime +14 -delete
```
```
0 3 * * *  /home/tq/bin/tq-backup.sh
```
Make the script executable before scheduling it. Copy backups off the VM.
Rehearse restoring an off-VM copy to a scratch database and check that it
contains the expected saved progress. [SQLite CLI reference](https://sqlite.org/cli.html)

```bash
restore_dir=$(mktemp -d)
backup=/path/to/downloaded/tq-backup.sqlite
sqlite3 "$restore_dir/tq.sqlite" ".restore '$backup'"
sqlite3 "$restore_dir/tq.sqlite" 'PRAGMA integrity_check;'  # expect ok
```

## 10. Upgrades

Run as `tq` from the checkout with the user-service environment from step 7
and the rootless Docker context. Allow a maintenance window and keep the service
stopped if any step fails.

```bash
(
  set -a &&
  . ./.env.production &&
  set +a &&
  systemctl --user stop terminal-quest &&
  mkdir -p "$HOME/backups" &&
  backup_dir=$(mktemp -d "$HOME/backups/pre-upgrade.XXXXXX") &&
  sqlite3 "$DB_PATH" ".backup '$backup_dir/tq.sqlite'" &&
  git pull --ff-only &&
  pnpm i --frozen-lockfile &&
  pnpm build &&
  pnpm images:build &&
  pnpm db:migrate &&
  systemctl --user start terminal-quest
)
```

On SIGTERM or SIGINT, the
server sends active clients a `closing` frame with reason `server_shutdown`,
marks unfinished attempts abandoned, and waits for sandbox teardown. Boot
cleanup sweeps leftover managed containers. After starting, check health,
open a level through Caddy, and confirm saved progress survived.

## 11. Operations checklist

- `docker ps --filter label=tq.managed=true` — live sandboxes. Count should never exceed `MAX_CONTAINERS`.
- If the reaper cannot remove a stray container, stop the app, identify the orphan by its labels, and remove that container by ID.
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

## Clean-VM verification (T9.3)

- [ ] Install from a fresh checkout and migrate the systemd service's database.
- [ ] Confirm rootless Docker resource limits and service startup after reboot.
- [ ] Check HTTPS, SPA navigation, CSP, the secure guest cookie, and a real WebSocket level clear through Caddy.
- [ ] Stop the service with an active attempt and verify the closing frame, abandonment, and sandbox cleanup. Verify orphan recovery on a separate abrupt restart.
- [ ] Verify scheduled backup, off-VM retrieval and restore, and an upgrade that preserves existing progress.

## Verification log
_Record each time this doc was followed on a clean machine, with corrections._

| Date | OS | Result | Corrections made |
|---|---|---|---|
| — | — | not yet verified | — |
