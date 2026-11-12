# Load Test Report — Terminal Quest

> **Status: PREPARED — TARGET VM RUN BLOCKED.** The driver and host sampler are implemented; no target VM has been provisioned. Result tables intentionally remain empty. Local driver regression tests do not satisfy T9.2. The task is complete only when the results below come from a real target-VM run.

## 1. Goal

Confirm that one VM can host the target number of concurrent sandboxes, that the capacity cap behaves, and that cleanup keeps resource usage stable.

**Targets (from plan §15 T9.2):**
- 20 concurrent active sessions on a 4 vCPU / 8 GB box with `MAX_CONTAINERS=20`
- The 21st `start` request gets HTTP 429 with a `Retry-After` header
- After sessions end, no sandbox containers/networks remain; memory returns near baseline
- Median keystroke-to-echo latency < 100 ms; sandbox start time p95 < 5 s

## 2. Test environment (fill in)

### VM and access handoff

If you have never configured a VM: create one Linux virtual server in your chosen
hosting account with the specifications below. Keep the provider's default SSH
administrator account. The agent can install and configure the application once
SSH access works; you do not need to configure Docker yourself.

| Requirement | Exact setup / access needed |
|---|---|
| Compute | Dedicated test VM with **4 vCPUs and 8 GB RAM**; record actual CPU model, memory bytes, provider/type and whether CPUs are shared/burstable. No other workloads or players during measurement. Do not resize to make a failing run pass. |
| OS | **Ubuntu 24.04 LTS x86-64** is the chosen test setup; Debian 12 and Ubuntu 22.04 are also supported by the draft deployment guide. cgroup v2 and systemd are required. This is a Linux VM, not Docker Desktop or a container-hosting service. |
| Storage | **At least 40 GB SSD** recommended for checkout, dependencies, image builds, SQLite and artifacts; record size and free space. This disk allowance is operational guidance, not a measured capacity requirement from the plan. |
| Network | SSH inbound only from the operator/load generator, normally TCP 22. Outbound DNS and HTTPS for apt, Node/pnpm dependencies and Docker image builds. Never expose Docker TCP or port 3001. Player containers keep `network:none`. |
| SSH | Host/IP, SSH port, login username, an existing local key path or SSH config alias, and a host-key fingerprint verified through the provider console. Configure public-key access on the VM. Keep private keys/passwords out of chat. |
| Administrator rights | Login with working sudo for packages, creating `tq`, enabling user-service lingering, cgroup delegation and optional Caddy/firewall setup. Rootless Docker and the app run as unprivileged `tq`, not as the SSH administrator. |
| Source | A checkout of this branch/commit on the VM, or permission to transfer a Git bundle/working source over SSH. Private-repository credentials are unnecessary if we transfer the checkout. |
| Service control | Access as `tq` to the rootless Docker Unix socket, image builds, `systemctl --user`, `journalctl --user`, the test DB/config, `/proc`, and artifact files. The test includes shortening TTL, restarting the service, and killing its main process to verify orphan recovery. |
| Load generator | Run the client on a separate computer (the current Windows workstation is sufficient), with Node 24, pnpm 9.15.9 and this checkout. Keep it awake and choose a VM near the generator. Record generator location, transport and network RTT because the <100 ms echo target includes that path. |

**A domain is optional for private T9.2 testing.** Start with SSH forwarding to
the loopback API; set `PUBLIC_ORIGIN=https://quest.loadtest.invalid` and send that
exact Origin from the driver. This hostname is only an Origin value and needs no
DNS in this mode. The driver explicitly carries the guest cookie inside the
encrypted SSH tunnel. This is not a browser/TLS/Caddy deployment verification.

For a production-shaped HTTPS run instead, provide a hostname, DNS A/AAAA
pointing to the VM, Caddy with a trusted certificate, HTTP/HTTPS reachability for
certificate issuance and the test client, and matching `PUBLIC_ORIGIN`. Keep
staging access restricted to the operator/test client. D-054's host-security
checks must pass before any public deployment. T9.3 remains a separate task.

| Item | Value |
|---|---|
| VM provider / type | |
| vCPU / RAM / disk | |
| OS / kernel | |
| Docker mode (rootless? runtime?) | |
| Node version | |
| Commit SHA | |
| Config (`MAX_CONTAINERS`, TTLs, `ENABLE_WORLDS`) | |
| Generator location / transport / RTT | |
| Artifact paths / UTC start and finish | |

## 3. Procedure

### 3.1 Prepare the dedicated target

Follow steps 3–7 of the [draft deployment guide](deploy.md), using Node **24**,
pnpm **9.15.9**, rootless Docker as `tq`, a built `tq-base` image, a migrated
throwaway DB at `/home/tq/data/loadtest.sqlite`, and the compiled production
server. For HTTPS also complete its Caddy section. Use this test environment:

```dotenv
PORT=3001
PUBLIC_ORIGIN=https://quest.loadtest.invalid
DB_PATH=/home/tq/data/loadtest.sqlite
DOCKER_SOCKET=/run/user/<tq-uid>/docker.sock
SANDBOX_IMAGE=tq-base
MAX_CONTAINERS=20
IDLE_TTL_SECONDS=900
MAX_AGE_SECONDS=3600
ENABLE_WORLDS=1,2
UNLOCK_ALL=0
LOG_LEVEL=info
```

Replace `<tq-uid>` with `id -u tq`; for HTTPS replace `PUBLIC_ORIGIN` with the
actual external origin. `ENABLE_WORLDS=1,2` matches the completed MVP release;
only w1-01 is used for this load scenario. Leave `SANDBOX_RUNTIME` unset for
the default run; document any runtime override. Keep per-container defaults:
256 MiB memory with no extra swap, 0.5 CPU, 128 PIDs and the basic/no-network
profile. Do not weaken rate limits or sandbox isolation.

Record `git rev-parse HEAD`, `uname -a`, `lscpu`, `free -b`, `df -h`, Docker
version/info, service process uid and `ss -lntp`. Confirm the VM and generator
clocks are synchronized before comparing their UTC phase timestamps. Confirm the rootless security
option, cgroup v2/delegation, no Docker TCP listener, and a non-root server uid.
As `tq`, verify effective limits, not just Docker create flags:

```bash
docker run --rm --network none --cap-drop ALL \
  --security-opt no-new-privileges --memory 64m --memory-swap 64m \
  --cpus 0.5 --pids-limit 32 --entrypoint /bin/sh tq-base -c \
  'cat /sys/fs/cgroup/memory.max /sys/fs/cgroup/memory.swap.max /sys/fs/cgroup/cpu.max /sys/fs/cgroup/pids.max'
# Expect: 67108864; 0; a quota/period ratio of 0.5; 32.
curl --fail http://127.0.0.1:3001/healthz  # must show ok:true,docker:true
docker ps -a --filter label=tq.managed=true  # must be empty before the run
```

Save these outputs with the run artifacts. A missing controller/limit is a
blocker; fix the VM configuration before load testing. Do not run `pnpm e2e`
or start another server against this Docker daemon during the test: server boot
orphan cleanup would sweep the measured sandboxes.

### 3.2 Run the driver and sampler

The implemented `tools/scripts/loadtest.ts`, invoked with `pnpm loadtest`:

1. Creates 21 distinct guests with `POST /api/guest`, keeps cookies only in memory, then waits 61 s for a fresh per-IP rate-limit window. WebSocket upgrades count against the common HTTP budget too.
2. Starts 20 guests over 60 s via `POST /api/levels/w1-01-first-words/start`. Records start request latency and opens each returned `wsPath` with that guest's cookie and the configured public Origin.
3. Holds 20 sessions open for five minutes. Sends a distinct input marker every 2–5 s, matches its PTY echo across output frames, and clears the line with Ctrl+U without Enter. Neither objective completes during the hold. Reported echo percentiles use only probes begun during the full-load hold; ramp timings are retained separately.
4. While all 20 sessions are active, starts the level as the 21st guest. Records HTTP 429, `Retry-After`, and the `sandbox capacity reached` response to distinguish it from HTTP rate limiting.
5. Runs `echo hello` and `whoami` and records time to `level_complete` for every guest. Deletes every acquired session on success, failure or Ctrl+C and waits 60 s for host cleanup. SIGKILL of the driver cannot run cleanup; use the host checks/reaper in that case.

The driver saves raw milliseconds, UTC phase boundaries, capacity response and
cleanup errors in JSON, without cookies or terminal frames. It refuses to
overwrite output files. Failed start/echo/completion, a disconnected socket,
premature completion, incorrect capacity response, cleanup failure or missed
latency target gives a nonzero exit. A successful client run still needs host
and recovery evidence; it never certifies the VM by itself.

On the VM in a `tq` shell with the Docker/user-service environment from
`deploy.md`, start the sampler in a separate SSH terminal. Use absolute artifact
paths (pnpm filter scripts run from `tools/scripts`):

```bash
cd /home/tq/terminal-quest
mkdir -p /home/tq/loadtest/run-01
server_pid=$(systemctl --user show terminal-quest -p MainPID --value)
pnpm loadtest:sample --server-pid "$server_pid" --out /home/tq/loadtest/run-01/host.csv
```

Leave it running for **60 s of idle baseline**, through the load run and its
60 s cooldown; then stop it with Ctrl+C. It records host CPU (0–100% across all
cores), host memory used as `MemTotal - MemAvailable`, server RSS, running/all
managed-container counts, load average and per-container Docker stats every
5 s. Container CPU percentages use Docker's separate per-core convention.
Metadata includes OS/kernel, CPU, RAM, Node, commit and Docker mode. Errors are
recorded and terminate sampling; gaps are not zero-valued measurements.

For private testing, open the SSH tunnel on the load generator and keep it open:

```bash
ssh -N -L 13001:127.0.0.1:3001 YOUR_SSH_ALIAS
```

In another terminal at the repository root on the load generator, run:

```bash
pnpm loadtest --base-url http://127.0.0.1:13001 \
  --origin https://quest.loadtest.invalid --out /absolute/path/run-01.json
```

On Windows use a Windows absolute path for `--out` and put the command on one
line. For HTTPS omit the SSH tunnel and use `--base-url https://your-hostname`
(Origin defaults to that URL). `pnpm loadtest --help` and
`pnpm loadtest:sample --help` print the interfaces. Expect about 8–10 minutes
for the main run, plus setup, baseline and recovery checks.

Independent spot checks during the run:
```bash
docker stats --no-stream --format '{{.Name}},{{.CPUPerc}},{{.MemUsage}}'
free -m
uptime
docker ps -q --filter label=tq.managed=true | wc -l
```
Post-run checks:
```bash
docker ps -a --filter label=tq.managed=true            # expect empty
# LAN cleanup belongs to T10.2 once per-attempt networks exist.
```
Save the post-run listing as evidence. Check all managed containers, including
stopped ones. Basic levels create no per-attempt networks; capture
`docker network ls` before/after and confirm no new leftovers, without claiming
T10.2 LAN cleanup is verified.

### 3.3 Idle expiry and abrupt-restart recovery

After the main run, set `IDLE_TTL_SECONDS=30` in the test service's environment
file and restart it. Run:

```bash
pnpm loadtest --base-url http://127.0.0.1:13001 \
  --origin https://quest.loadtest.invalid --mode idle --idle-ttl-seconds 30 \
  --out /absolute/path/idle-01.json
```

The driver waits without further stdin after shell readiness. Expect a
`closing:idle` frame within TTL plus the 30 s reaper interval (driver deadline
adds 15 s transport margin), then zero managed containers. Save JSON, container
listing and reaper logs. Restore TTL to **900** and restart before orphan testing.

For orphan recovery, as `tq` on the VM use a private temporary cookie file and
create one unfinished attempt. These commands execute only HTTP requests on
the host; all player-shell execution remains in the sandbox:

```bash
cookie_file=$(mktemp)
chmod 600 "$cookie_file"
curl --fail --silent --cookie-jar "$cookie_file" -X POST http://127.0.0.1:3001/api/guest >/dev/null
# The compiled service sets Secure cookies. On this private loopback request,
# pass the saved cookie explicitly rather than depending on curl's cookie policy.
cookie=$(awk '$6 == "tq_session" {print "tq_session=" $7}' "$cookie_file")
curl --fail --silent -H "Cookie: $cookie" -X POST \
  http://127.0.0.1:3001/api/levels/w1-01-first-words/start
rm -- "$cookie_file"
unset cookie
docker ps -a --filter label=tq.managed=true  # save the container ID before killing
server_pid=$(systemctl --user show terminal-quest -p MainPID --value)
kill -KILL "$server_pid"
# Restart=on-failure should restart the service after 3 s; otherwise investigate/start it.
systemctl --user status terminal-quest
curl --fail http://127.0.0.1:3001/healthz
docker ps -a --filter label=tq.managed=true  # must become empty after boot sweep
journalctl --user -u terminal-quest --since '10 minutes ago' --no-pager
```

Poll health and the listing until the restart/boot sweep finishes (allow up to
60 s); preserve timestamps, old/new main PIDs, the original orphan ID and the
boot-sweep log. No DELETE, graceful stop, manual `docker rm`, or 900 s idle TTL
should account for that removal. Restart the sampler with the new PID if
sampling the recovery phase. Never do this on a VM serving real users.

### 3.4 Judge memory stability and preserve evidence

Use the CSV plus JSON phase boundaries. Compare median host used memory and
server RSS over the initial 60 s baseline with the final 60 s after deletion.
For this dedicated VM, define "near baseline" before the run as host used
memory within **256 MiB** and server RSS within **32 MiB** of baseline. Record
both deltas, peak host memory (target <6 GB = 6,000,000,000 bytes), peak CPU,
peak server RSS and the memory trend over the hold. These recovery tolerances
are an operational test criterion (D-055), not measurements. If recovery or
trend is inconclusive, repeat full ramp/hold/cleanup cycles and investigate;
do not call one noisy snapshot stable.

Retain driver JSON, host CSV/metadata/errors, host preflight output, configuration
(without credentials), logs and final container/network listings under one run
ID. Copy artifacts off the VM. Populate the tables below from those files,
including failures and the generator transport; do not substitute local mock
tests or Windows Docker Desktop results. Only then assess T9.2 completion.

## 4. Results (fill in after running)

### 4.1 Capacity & cleanup
| Check | Expected | Observed |
|---|---|---|
| Concurrent sessions sustained | 20 | |
| 21st start response | 429 + Retry-After | |
| Leftover containers after run | 0 | |
| Idle expiry destroyed sandbox | yes | |
| Orphan sweep after restart | yes | |

### 4.2 Latency & resource use
| Metric | Target | Observed |
|---|---|---|
| Sandbox start time p50 / p95 | — / < 5 s | |
| Echo latency p50 / p95 | < 100 ms (p50) | |
| Peak host CPU % | — | |
| Peak host memory used | < 6 GB | |
| Server process RSS (peak) | — | |
| Host used memory baseline / post-cleanup / delta | delta ≤ 256 MiB | |
| Server RSS baseline / post-cleanup / delta | delta ≤ 32 MiB | |

### 4.3 Observations & issues
_Anything that failed, was slow, or surprised you; link to related entries in `DECISIONS.md` or `PROGRESS.md → Known gaps`._

## 5. Conclusions & follow-ups
_Recommended `MAX_CONTAINERS` for this VM size, resource limits adjustments, whether gVisor/microVM is needed, etc._
