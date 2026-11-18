# Deploying Terminal Quest (single VM)

> **Status: verified on a fresh Ubuntu 24.04 WSL 2 distro (2026-11-11).** Local HTTPS, rootless isolation, service recovery, backups and upgrade passed. Public DNS/ACME and the eventual production host remain separate checks. [Evidence](deploy-artifacts/2026-11-11-wsl/README.md)

## 1. Overview

The VM runs these services.

- **Caddy** (TLS, reverse proxy) → public `:443`
- **Terminal Quest server** on `127.0.0.1:3001`. Node 24 matches CI and serves the built web app, REST API, and WebSocket.
- **Rootless Docker** (sandbox containers for players) running under a dedicated unprivileged user
- **SQLite** database file with nightly backups

The server controls Docker. Running Docker as an unprivileged user limits the host privileges available to the daemon and sandboxes.

## 2. Requirements

- Ubuntu 24.04 x86-64, systemd and cgroup v2. The commands below target this OS and architecture. For Debian or another architecture, adapt the package repository and Node archive using the linked upstream instructions.
- A sudo administrator, outbound package-download access, and a Git clone URL readable by the service user. Allow disk space for dependencies, image layers and backups (40 GB is suggested headroom).
- The 4-processor / 8 GB WSL target sustained 20 sessions in T9.2; this is not a capacity measurement for another host. [Measured results](loadtest.md)
- A DNS name pointing to the VM (e.g. `quest.example.com`)
- Ports 80 and 443 open; nothing else needed publicly

Run administrator commands in your normal sudo shell. Blocks marked **as `tq`**
run after `sudo -iu tq`; use `exit` to return. Do not add `tq` to the rootful
Docker group. For a private WSL rehearsal without DNS, see section 13.

## 3. Create the service user

```bash
sudo adduser --disabled-password --gecos "" tq
sudo loginctl enable-linger tq          # lets the user's services run without a login session
```

## 4. Install rootless Docker for `tq`

```bash
sudo apt-get update
sudo apt-get install -y uidmap dbus-user-session slirp4netns fuse-overlayfs curl ca-certificates git sqlite3
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
sudo tee /etc/apt/sources.list.d/docker.sources >/dev/null <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: noble
Components: stable
Architectures: amd64
Signed-By: /etc/apt/keyrings/docker.asc
EOF
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-ce-rootless-extras docker-buildx-plugin
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
docker run --rm --cpus 0.5 --memory 64m --pids-limit 32 alpine sh -c \
  'cat /sys/fs/cgroup/memory.max /sys/fs/cgroup/cpu.max /sys/fs/cgroup/pids.max'
# Expect 67108864, "50000 100000", and 32, respectively.
grep '^tq:' /etc/subuid /etc/subgid    # each range must contain at least 65536 IDs
```

The socket will be at `/run/user/<tq-uid>/docker.sock` — you'll use this as `DOCKER_SOCKET`.

Confirm the security options list `rootless`, the cgroup version is 2, and Docker reports no warnings about missing CPU, memory, or PID limits. Keep the rootless context selected for image builds and operations. [Docker rootless setup](https://docs.docker.com/engine/security/rootless/) · [Resource limits](https://docs.docker.com/engine/security/rootless/tips/#limiting-resources)

## 5. Install Node and build the app

Return to the administrator shell. Install the current Node 24 x86-64 archive
from Node's official distribution, checking its published SHA-256, and pin pnpm.
Use a trusted administrator connection for these downloads. Node also publishes
[signature-verification instructions](https://github.com/nodejs/release#verifying-binaries).

```bash
sudo apt-get install -y xz-utils build-essential python3
node_tmp=$(mktemp -d)
cd "$node_tmp"
curl -fsSLO https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt
node_archive=$(awk '/linux-x64.tar.xz$/ {print $2}' SHASUMS256.txt)
curl -fsSLO "https://nodejs.org/dist/latest-v24.x/$node_archive"
grep " $node_archive\$" SHASUMS256.txt | sha256sum -c -
sudo tar -xJf "$node_archive" --strip-components=1 -C /usr/local
sudo /usr/local/bin/npm install --global pnpm@9.15.9
/usr/local/bin/node --version        # v24.x
/usr/local/bin/pnpm --version        # 9.15.9
```

**As `tq`**, set `repo_url` to your repository's clone URL and `release_ref`
to the reviewed branch, tag or commit. The clone must include the repository
layout, not just the compiled server directory.

```bash
repo_url=https://your-git-host/your-org/terminal-quest.git
release_ref=your-reviewed-release
git clone "$repo_url" ~/terminal-quest
cd ~/terminal-quest
git checkout "$release_ref"
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

```bash
chmod 600 .env.production
```

From the checkout as `tq`, run the migration before starting the service:

```bash
(umask 077 && set -a && . ./.env.production && pnpm db:migrate)
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
ExecStart=/usr/local/bin/node apps/server/dist/index.js
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
UMask=0077
TimeoutStopSec=60

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
repository ([upstream installation](https://caddyserver.com/docs/install#debian-ubuntu-raspbian)).

```bash
sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl gpg
curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt | sudo tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
sudo chmod o+r /usr/share/keyrings/caddy-stable-archive-keyring.gpg /etc/apt/sources.list.d/caddy-stable.list
sudo apt-get update
sudo apt-get install -y caddy
```

Save the following as `/etc/caddy/Caddyfile` with your public domain.

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
sudo systemctl enable --now caddy
sudo systemctl reload caddy
```

Caddy proxies WebSockets automatically. Keep Caddy on the same host and point it
at `127.0.0.1`. The compiled server listens on that address and uses the
immediate client IP forwarded by Caddy for rate limits. Set `PUBLIC_ORIGIN` to
the external HTTPS origin. The compiled server always marks guest cookies
`Secure`, and its Content-Security-Policy allows same-origin assets and the
WebSocket at that public origin. [Caddy reverse proxy reference](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy)

## 9. Backups

**As `tq`**, run a nightly backup via a persistent user timer. The script reads
`DB_PATH` from the deployment environment file.

```bash
# ~/bin/tq-backup.sh
#!/usr/bin/env bash
set -euo pipefail
umask 077
. "$HOME/terminal-quest/.env.production"
mkdir -p "$HOME/backups"
sqlite3 "$DB_PATH" ".backup '$HOME/backups/tq-$(date +%F).sqlite'"
find "$HOME/backups" -name 'tq-*.sqlite' -mtime +14 -delete
```

Create `~/bin` before saving the script and make it executable with
`chmod 700 ~/bin/tq-backup.sh`. Save these units in `~/.config/systemd/user/`:

```ini
# tq-backup.service
[Unit]
Description=Back up Terminal Quest SQLite

[Service]
Type=oneshot
ExecStart=%h/bin/tq-backup.sh
UMask=0077
```

```ini
# tq-backup.timer
[Unit]
Description=Nightly Terminal Quest backup

[Timer]
OnCalendar=*-*-* 03:00:00
Persistent=true

[Install]
WantedBy=timers.target
```

```bash
systemctl --user daemon-reload
systemctl --user enable --now tq-backup.timer
systemctl --user start tq-backup.service
systemctl --user list-timers tq-backup.timer --no-pager
journalctl --user -u tq-backup.service -n 10 --no-pager
sqlite3 "$HOME/backups/tq-$(date +%F).sqlite" 'PRAGMA integrity_check;'
```

The timer uses the VM's timezone (`timedatectl`). Linger from step 3 keeps it
running without a login. The manual service start checks the backup immediately.
Copy backups off the VM, for example from your administrator workstation:

```bash
scp tq@your-vm:/home/tq/backups/tq-YYYY-MM-DD.sqlite ./tq-backup.sqlite
```

Use your configured SSH key/access policy. On WSL, a Windows filesystem copy is
off the distro, but is not protection against loss of the physical computer.
Rehearse restoring an off-VM copy to a scratch database and check that it
contains the expected saved progress. [SQLite CLI reference](https://sqlite.org/cli.html)

```bash
restore_dir=$(mktemp -d)
backup=/path/to/downloaded/tq-backup.sqlite
sqlite3 "$restore_dir/tq.sqlite" ".restore '$backup'"
sqlite3 "$restore_dir/tq.sqlite" 'PRAGMA integrity_check;'  # expect ok
sqlite3 "$restore_dir/tq.sqlite" 'SELECT level_id, completions, best_xp FROM level_progress;'
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

The upgrade block assumes a release branch with an upstream. If step 5 selected
a detached tag/commit, replace `git pull --ff-only` with `git fetch origin &&
git checkout <reviewed-new-release>`. Keep the backup and stopped-service failure
behavior. Restore both the previous code/image and its matching database backup
if rolling back an incompatible migration; do not overwrite a live database.

## 11. Operations checklist

- `docker ps --filter label=tq.managed=true` — live sandboxes. Count should never exceed `MAX_CONTAINERS`.
- If the reaper cannot remove a stray container, stop the app, identify the orphan by its labels, and remove that container by ID.
- Disk: `docker system df`; prune dangling layers monthly.
- Logs: `journalctl --user -u terminal-quest --since "1 hour ago"`.
- Updates: apply OS security updates regularly; rebuild `tq-base` periodically to pick up Debian security fixes.

## 12. Troubleshooting

| Symptom                                   | Likely cause / fix                                                                                                 |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `/healthz` shows `docker:false`           | Wrong `DOCKER_SOCKET`; docker user service not running (`systemctl --user status docker`); `XDG_RUNTIME_DIR` unset |
| Start level returns 429                   | `MAX_CONTAINERS` reached; check stuck sandboxes; reaper logs                                                       |
| Resource limits ignored                   | cgroup v2 delegation not applied (step 4)                                                                          |
| Terminal connects then closes immediately | Origin mismatch: `PUBLIC_ORIGIN` must equal the browser origin exactly                                             |
| `sudo` fails inside `basic` levels        | Expected: `no-new-privileges` is set for the basic profile                                                         |

## 13. Private WSL 2 rehearsal

This exercises the Linux deployment with local HTTPS. It does not verify public
DNS, ACME issuance, internet reachability, a cloud firewall, or Windows boot
autostart. Keep the eventual production-host checks in [security-review.md](security-review.md).

From Windows PowerShell, install a separate distro (do not reuse a configured
deployment). WSL must already be installed and version 2 available:

```powershell
wsl --install Ubuntu-24.04 --name TerminalQuest-T93 --web-download --no-launch
wsl -d TerminalQuest-T93 -u root
```

Confirm `ps -p 1 -o comm=` reports `systemd`. If necessary, enable
`[boot] systemd=true` in `/etc/wsl.conf`, terminate only this distro with
`wsl --terminate TerminalQuest-T93`, and relaunch. See
[Microsoft's systemd instructions](https://learn.microsoft.com/en-us/windows/wsl/systemd).
Run sections 3–9 inside this distro. Keep the checkout on the Linux filesystem.
A local bare Git origin populated from a bundle is sufficient if remote Git
credentials are unavailable; it must contain the reviewed release and upgrade.

Use `PUBLIC_ORIGIN=https://localhost` and this private Caddyfile instead of the
public-domain example:

```caddyfile
https://localhost {
    bind 127.0.0.1
    tls internal
    encode zstd gzip
    header {
        Strict-Transport-Security "max-age=31536000"
        X-Content-Type-Options "nosniff"
        Referrer-Policy "no-referrer"
    }
    reverse_proxy 127.0.0.1:3001
}
```

After reloading Caddy, copy only its public root certificate for the test client:

```bash
sudo install -m 0644 -o tq -g tq \
  /var/lib/caddy/.local/share/caddy/pki/authorities/local/root.crt \
  /home/tq/caddy-root.crt
curl --cacert /home/tq/caddy-root.crt https://localhost/healthz
curl --cacert /home/tq/caddy-root.crt -I https://localhost/map
```

Use that CA with the HTTPS/WebSocket test client (`NODE_EXTRA_CA_CERTS` for Node).
Do not disable certificate verification. A browser also needs to trust the local
CA if used for the rehearsal. Keep private keys and guest cookies out of evidence.
Copy a test backup to Windows, then return it to a scratch Linux path and restore
it using section 9. Compare saved progress, not just SQLite integrity.

To exercise boot recovery, record `ps -p 1 -o lstart=` and the services'
`ActiveEnterTimestamp`/`InvocationID`, run `wsl --terminate TerminalQuest-T93`
from PowerShell, then relaunch the distro. The shared kernel's boot ID can stay
unchanged while another WSL distro runs; use the new init/service timestamps
as evidence of this distro's restart. Caddy can briefly return 502 while Node
starts; wait for `/healthz` to report both `ok:true` and `docker:true`.
Check Caddy and the lingering user's Docker/app/timer services before manually
starting any of them. This is a distro restart, not a Windows reboot.
[Systemd services do not keep a WSL instance alive](https://learn.microsoft.com/en-us/windows/wsl/systemd):
keep a WSL shell open during interactive testing. Linger does not turn WSL into
an always-on server; a persistent timer can catch up when the distro next starts.
At the end,
terminate only the test distro; leave existing distros, global `.wslconfig`,
Docker Desktop and its containers unchanged.

## Clean-VM verification (T9.3)

- [x] Install from a fresh checkout and migrate the systemd service's database (`install.log`, `build-retry.log`, `service.log`).
- [x] Confirm rootless Docker resource limits and service startup after distro restart (`https-smoke-final.log`, `before-reboot.log`, `after-reboot.log`).
- [x] Check local-CA HTTPS, SPA navigation, CSP, the secure guest cookie, and a real WebSocket level clear through Caddy (`https-smoke-final.log`).
- [x] Stop the service with an active attempt and verify the closing frame, abandonment, and sandbox cleanup. Verify orphan recovery on a separate abrupt restart (`shutdown.log`, `orphan.log`).
- [x] Verify scheduled backup, off-distro Windows retrieval and scratch restore, and an upgrade that preserves existing progress (`backup-final.log`, `restore.log`, `upgrade.log`, `progress-after-upgrade.log`).

All evidence filenames above are under [the retained run directory](deploy-artifacts/2026-11-11-wsl/README.md).
These ticks apply to the WSL/local-CA rehearsal, not public-host certification.

## Verification log

_Record each time this doc was followed on a clean machine, with corrections._

| Date | OS | Result | Corrections made |
| ---- | --- | --- | --- |
| 2026-11-11 (America/Santiago) | Fresh Ubuntu 24.04.5 x86-64, WSL 2.6.3 / kernel 6.6.87.2, systemd 255; Node 24.22.3, pnpm 9.15.9, Docker 29.9.3 rootless, Caddy 2.11.9 | **Passed for the requested WSL rehearsal.** Clean install/build/migration; effective 256-MiB / 0.5-CPU / 128-PID sandbox limits; strict-CA HTTPS and WebSocket clears; graceful and abrupt recovery; automatic distro-boot services; timer backup, Windows retrieval and restore; fast-forward `b3ad116` → `533abaf` preserved the original 55-XP completion. `pnpm verify`: 513 tests on Windows and 513 on Linux. [Raw evidence and limitations](deploy-artifacts/2026-11-11-wsl/README.md) | Added complete apt/Node/pnpm installation, correct `/usr/local/bin/node` service path, restrictive migration umask, backup units/schedule, explicit release selection, detached-release upgrade instructions and WSL/local-CA procedure. WSL's shared boot ID stays unchanged; use init/service timestamps. |
