# Terminal Quest on NeaTech

Deploy Terminal Quest to my existing NeaTech VPS so I can play all five worlds from my phone while my home PC is off. This deployment is for personal use, with one active game session and private HTTPS access.

## Execution instructions for Codex

When I say **go** and identify the VPS, execute this deployment. Take ownership of the SSH connection, preflight, source transfer, installation, configuration, tests, troubleshooting, service startup, and backup setup. Use my existing authorized access and make routine decisions yourself. Keep working through recoverable failures while I am away. Ask me only when specific information, interactive authentication, an approval, or a disruptive change requires my involvement. Continue independent work while waiting.

For the few steps I may need to perform, give me the exact prompt or action. If the VPS already has working SSH, sudo, and an authenticated Tailscale connection, use them. If SSH or sudo requires an interactive login, or Tailscale requires me to approve device enrollment or HTTPS, take the setup as far as possible before asking for that action. Finish the deployment and automated verification first. Reserve a single phone smoke test for me unless an authorized phone session is available to Codex.

In the next chat I can attach this file and send: **Go. Deploy Terminal Quest to my NeaTech VPS using this handoff. VPS: [hostname or IP]. SSH: [username and port].**

## Starting point

- **VPS.** NeaTech with 1 vCPU, 1 GB RAM, and 10 GB storage. Its OS, architecture, free space, and existing workloads need checking.
- **Source.** Deploy commit `6fab8fb` from the `terminal-quest` checkout. Verify the remote contains the commit. If it exists only in the local checkout, transfer it as a Git bundle over SSH.
- **Local evidence.** All 67 levels passed lint, Worlds 3–5 passed three-seed Docker acceptance, and the local app served all five worlds and started a guest sandbox. The NeaTech VPS and phone connection still need verification. [Project status](PROGRESS.md)

## Access I need to provide

- The VPS hostname or IP, the SSH username and port, and a working SSH connection with sudo access. Use my existing local SSH key. Verify the SSH host fingerprint through the provider console if this is a first connection.
- Whether anything else runs on the VPS and whether any changes could interrupt it.
- Tailscale sign-in on the VPS and on my phone when prompted, including permission to enable HTTPS for the private network.
- Start with a fresh guest database unless I explicitly ask to move my existing desktop progress.

## 1. Check the host

Inspect the distro, architecture, systemd, cgroup version, available RAM and swap, and free space. Identify existing services and Docker workloads before changing host settings. Ubuntu 24.04 x86-64 is the documented path. Record a resource baseline so the final report can show how much headroom remains. [Deployment requirements](deploy.md#2-requirements)

```bash
cat /etc/os-release
uname -m
ps -p 1 -o comm=
stat -fc %T /sys/fs/cgroup
free -h
df -h / /home
sudo ss -lntp
```

Confirm outbound package and image downloads work, and keep the provider console available for recovery. Preserve existing workloads. In particular, review the guide's rootful Docker shutdown step before running it on a host that already uses Docker.

## 2. Set up the runtime

Create a dedicated `tq` service account and enable systemd user lingering. Install Node 24, pnpm `9.15.9`, and rootless Docker Engine 28 or later. As `tq`, verify that Docker enforces CPU, memory, and PID limits and supports the isolated bridge required by the networking lessons. Resolve any host isolation blocker before making the game reachable. [Rootless Docker setup](deploy.md#4-install-rootless-docker-for-tq) · [Docker resource-limit requirements](https://docs.docker.com/engine/security/rootless/tips/#limiting-resources)

## 3. Build the app and sandbox images

Check out `6fab8fb` and keep the repository layout intact. Install dependencies with `pnpm install --frozen-lockfile`, build the app, and run `pnpm images:build` in the rootless Docker context. Confirm all four images are available to the service account: `tq-base`, `tq-web`, `tq-dns`, and `tq-ssh`.

Build sequentially and check free space and memory between steps on the 1 GB / 10 GB VPS. If the host cannot complete the builds, build on compatible Linux and transfer the app artifacts and Docker images. The runtime dependencies, including the native SQLite module, need to match the VPS platform.

## 4. Configure the persistent game service

Use the repository's systemd user service and the built entry point, `node apps/server/dist/index.js`. The built server hosts the web app, API, and WebSocket on the same loopback port. Apply `pnpm db:migrate` with the same database path and environment the service will use. Use these settings in place of the deployment guide's MVP defaults. [Configuration and migration](deploy.md#6-configure-and-migrate)

```dotenv
PORT=3001
PUBLIC_ORIGIN=https://<actual-vps-name>.<tailnet-name>.ts.net
DB_PATH=/home/tq/data/tq.sqlite
DOCKER_SOCKET=/run/user/<tq-uid>/docker.sock
SANDBOX_IMAGE=tq-base
MAX_CONTAINERS=1
ENABLE_WORLDS=1,2,3,4,5
UNLOCK_ALL=0
```

Substitute the actual UID from `id -u tq` and the exact private HTTPS origin from Tailscale. Enable the game service so it starts with the VPS. [Systemd user service](deploy.md#7-run-the-server-as-a-systemd-user-service)

## 5. Set up private phone access

Install Tailscale on the VPS and phone. Run `sudo tailscale up` on the VPS and sign both devices into the same private network. On the VPS, run `sudo tailscale serve --bg 3001` and complete the HTTPS setup prompt. Check the mapping with `tailscale serve status`. Set `PUBLIC_ORIGIN` to the exact HTTPS origin Serve gives you and restart the game service. Keep the app port on loopback and use tailnet access rules to limit who can connect. [Linux installation](https://tailscale.com/docs/install/linux) · [Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve)

## 6. Verify gameplay and recovery

- Confirm `/healthz` reports `{"ok":true,"docker":true}`. Check that guest sign-in works and the map lists all five worlds and 67 levels.
- Verify guest sign-in and a complete live WebSocket playthrough of `w1-01-first-words` through the private HTTPS URL from a connected client. Then perform the final phone check over mobile data if Codex has access to an authorized phone session. Otherwise, give me the link and the single test to run on my phone. Use my phone browser for the subsequent progress check if its guest profile exists.
- As the `tq` user on the VPS, validate the systemd shim, LAN sidecars, SSH sidecar, and the network capabilities used in later worlds. Point the runner at the service's rootless Docker socket. The runner creates fresh test sandboxes directly and can briefly hold two attempts, plus their sidecars, even with `MAX_CONTAINERS=1`. Run one command at a time during an idle window. If the harness exceeds the VPS's RAM, record that limitation and verify the affected lessons one attempt at a time in a separate test session.
- Measure peak RAM and remaining storage. End the smoke session and confirm that no test sandboxes or networks remain after cleanup.
- Restart the game service and confirm the phone browser keeps its guest progress. Verify that the service is enabled to start after a VPS reboot. Coordinate any disruptive reboot first if the VPS hosts other services.

```bash
export DOCKER_SOCKET="/run/user/$(id -u)/docker.sock"
pnpm levels:lint
pnpm levels:test --level w4-14-systemd-units --seeds 1
pnpm levels:test --level w3-11-curl-and-dns --seeds 1
pnpm levels:test --level w3-12-ssh-keys --seeds 1
pnpm levels:test --level w5-06-network-debug --seeds 1
```

For failures, check `journalctl --user -u terminal-quest`, `journalctl --user -u docker`, and `tailscale serve status`. Compare `free -h`, `df -h`, and `docker system df` with the preflight baseline before deciding whether more resources are needed.

## 7. Back up the game and hand over the URL

Enable the SQLite backup timer, limit local retention on the 10 GB disk, and verify a restore into a scratch database. Copy a backup to an authorized off-VPS destination when available. Record the private phone URL, service status, deployed commit, backup location, measured RAM and disk usage, and any host-specific limitations. Desktop guest progress belongs to the existing browser session. Treat migrating it as a separate decision. [Backup procedure](deploy.md#9-backups)

**Deployment is verified when all automated checks pass and the game is reachable through the private HTTPS link. The final phone check confirms I can play with my home PC off. Calling all five worlds playable requires the VPS checks for systemd, LAN, SSH, and network capabilities to pass.**
