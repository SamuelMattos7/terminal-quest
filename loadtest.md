# Load Test Report — Terminal Quest

> **Status: PASSED ON WSL 2 — 2026-11-11 (America/Santiago).** A real 20-session run, capacity rejection, resource recovery, idle expiry and abrupt-restart orphan cleanup passed on the user-selected WSL target (D-056). The first ramp exposed and led to a tested process-limit correction (D-057). Raw evidence is retained in [loadtest-artifacts/2026-11-11-wsl](loadtest-artifacts/2026-11-11-wsl/README.md). These results do not complete T9.3 or certify a future cloud host.

## 1. Goal

Confirm that one VM can host the target number of concurrent sandboxes, that the capacity cap behaves, and that cleanup keeps resource usage stable.

**Targets (from plan §15 T9.2):**
- 20 concurrent active sessions on a 4 vCPU / 8 GB box with `MAX_CONTAINERS=20`
- The 21st `start` request gets HTTP 429 with a `Retry-After` header
- After sessions end, no sandbox containers/networks remain; memory returns near baseline
- Median keystroke-to-echo latency < 100 ms; sandbox start time p95 < 5 s

## 2. Test environment

### VM and access handoff

For a hosted target (an alternative to the WSL setup in §3.0): create one Linux virtual server in your chosen
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
| VM provider / type | Local WSL 2.6.3.0 distro `TerminalQuest-T92`; Windows 11 Home 10.0.26200.9711. No hosting provider. Physical Ryzen 5 5600, 12 logical processors, 17,097,650,176 memory bytes. |
| vCPU / RAM / disk | WSL processors=4, memory=8GB, swap=0; effective Linux memory 8,329,084,928 bytes (7,943 MiB). ext4 VHD: 1007 GiB virtual capacity, 3.6 GiB used at preflight; Windows C: had 123,525,042,176 free bytes before provisioning. |
| OS / kernel | Ubuntu 24.04.5 LTS x86-64; 6.6.87.2-microsoft-standard-WSL2; systemd and cgroup v2. |
| Docker mode (rootless? runtime?) | Engine 29.9.3, rootless as `tq` uid 1000, systemd cgroup driver, overlayfs, default runtime. No daemon warnings or Docker TCP listener. Image `sha256:b8da3c0b424dd9314844e9fe2e76b7625b60f782cf05fbfeed4db154d6320ca7`. |
| Node version | v24.15.0 on both target and Windows generator; pnpm 9.15.9. |
| Commit SHA | Passing run: `3b71d9eeeaff56ba80a1df146f91d699d1eba3ae`. First failed ramp: `e7246c7`. |
| Config (`MAX_CONTAINERS`, TTLs, `ENABLE_WORLDS`) | `MAX_CONTAINERS=20`, idle 900 s (30 s for the separate idle check), max age 3600 s, Worlds 1,2, `UNLOCK_ALL=0`, `SANDBOX_IMAGE=tq-base`, port 3301. Per sandbox: 256 MiB, no extra swap, 0.5 CPU, 128 PIDs, basic/no-network. Full env in the artifacts. |
| Generator location / transport / RTT | Windows on the same PC, outside the WSL VM, via localhost forwarding to `127.0.0.1:3301`; Origin `https://quest.loadtest.invalid`. Ten health round trips: first 35.82 ms, later 1.66–4.14 ms. No internet latency or Caddy/TLS path. |
| Artifact paths / UTC start and finish | Sampler baseline began 2026-11-12 00:36:21.709Z; client 00:38:03.417Z–00:46:15.889Z. Hold 00:40:04.912Z–00:45:07.094Z. Restoration recorded at 00:53:05.521Z after recovery. These are November 11 locally. See raw JSON/CSV for exact phases. |

## 3. Procedure

### 3.0 Local WSL 2 target

WSL 2 is an accepted local target for T9.2 (D-056). Report its results as WSL
measurements on shared Windows hardware; a future hosting VM requires its own
benchmark. It does not complete T9.3's clean-VM/Caddy/TLS rehearsal.

Inspect `wsl --version`, `wsl --list --verbose`, host RAM/CPU/free disk and any
existing `%UserProfile%\.wslconfig`. Use a separate Ubuntu distro, not Docker
Desktop's internal distro. This run installed it with:

```powershell
wsl --install Ubuntu-24.04 --name TerminalQuest-T92 --version 2 --no-launch --web-download --location C:\Users\samym\WSL\TerminalQuest-T92
```

Preserve the original global WSL configuration. Apply these temporary settings
only during a controlled window, because they affect all WSL 2 distributions:

```ini
[wsl2]
processors=4
memory=8GB
swap=0
```

Stop other WSL/Docker workloads with the operator's authorization, stop Docker
Desktop, then use `wsl --shutdown` to apply the settings. This run had no prior
`.wslconfig`; restore its absence afterward and restart the previously running
Desktop containers. Keep the installed test distro for future runs.

Inside Ubuntu, follow the rootless Docker, cgroup delegation, `tq` user, Node,
build and migration steps below. Keep the checkout/database in the Linux
filesystem, e.g. `/home/tq/terminal-quest`, rather than the Windows/OneDrive mount.
Use the production service with `PORT=3301` and the test Origin. Verify `nproc`
reports 4 and the cgroup/kernel checks pass. Keep a foreground WSL process alive
while testing; systemd services alone do not keep the distribution awake.

Run the sampler inside WSL. Run the client from Windows through localhost
forwarding, without an SSH tunnel:

```powershell
pnpm loadtest --base-url http://127.0.0.1:3301 --origin https://quest.loadtest.invalid --out C:\absolute\path\run.json
```

Record the Windows generator, WSL version/kernel and effective Linux memory
(the 8-GB ceiling leaves some memory reserved for the kernel), and verify no
other distro is running during the measured window. Use distinct artifact names
for failed and successful attempts; perform idle/orphan checks before restoring
global settings. No public listener or domain is needed for this local run.

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

## 4. Measured results

Recompute the metrics with
`python loadtest-artifacts/2026-11-11-wsl/analyze.py`.
The raw client intentionally leaves `targetVmVerified=false`; host/recovery
certification comes from the separate evidence, not the client alone.

### 4.1 Capacity & cleanup
| Check | Expected | Observed |
|---|---|---|
| Concurrent sessions sustained | 20 | **20 for 302.18 s**; all 58 full-load host samples show 20 running/total managed containers. All 20 clients remained usable and completed the reference commands. |
| 21st start response | 429 + Retry-After | **429**, `Retry-After: 30`, body `{"error":"sandbox capacity reached"}`; distinct from IP rate limiting. |
| Leftover containers after run | 0 | **0**, including stopped containers; all 12 cooldown samples and final listing were empty. Default bridge/host/none network IDs unchanged. |
| Idle expiry destroyed sandbox | yes | **yes**, `closing:idle` after **57.18 s** with idle TTL 30 s plus the 30 s reaper cadence; reaper log `idle:1`, zero leftovers. |
| Orphan sweep after restart | yes | **yes**, SIGKILL of PID 14353, automatic restart to PID 14538, `orphans:1` boot log and original container not found within **5 s**, with TTL 900 s. No DELETE/manual removal accounted for cleanup. |

### 4.2 Latency & resource use
| Metric | Target | Observed |
|---|---|---|
| Sandbox start time p50 / p95 | — / < 5 s | **328.01 / 353.14 ms**, 20 starts. |
| Echo latency p50 / p95 | < 100 ms (p50) | **1.27 / 1.57 ms**, 1,735 full-load probes; ramp probes excluded. |
| Reference completion time p50 / p95 | — | **95.29 / 1,049.19 ms**, 20 `level_complete` results. |
| Peak sampled host CPU % | — | **8.86%**, aggregate across the four guest processors. |
| Peak sampled host memory used | < 6 GB | **837.58 MiB** (0.878 GB), computed as MemTotal minus MemAvailable. |
| Server process RSS (sampled peak) | — | **293.01 MiB**, during startup/baseline; roughly 96–103 MiB during hold/cleanup. |
| Host used memory baseline / post-cleanup / delta | delta ≤ 256 MiB | **831.43 / 686.72 / −144.71 MiB**, medians over the defined 60 s windows. |
| Server RSS baseline / post-cleanup / delta | delta ≤ 32 MiB | **292.14 / 103.08 / −189.05 MiB**, same windows. |

The host-memory median was **818.40 MiB** in the hold's first minute and
**819.79 MiB** in its last minute (increase 1.38 MiB). Both recovery deltas were
negative. RSS fell during the ramp; allocation/GC causes were not profiled.

### 4.3 Observations & issues
1. **First attempt failed at seven active sessions.** Attempt eight returned
   HTTP 500 due to setup child exec EAGAIN. The UID-wide `nproc=128` limit
   counted shared rootless-host tasks. An isolated one-process probe reproduced
   the issue with a smaller nproc limit while its cgroup still had room. D-057
   explicitly corrects plan §7.3: keep the per-container PID controller at 128,
   remove the incorrectly shared UID budget, and preserve the remaining limits.
   Two kernel regressions failed before the fix and passed afterward, including
   PID exhaustion and a usable neighboring container for both root and player.
   The failed run, raw samples and reproduction are retained.
2. **Sampling cadence is observed, not assumed.** The sampler scheduled five
   seconds; this shared WSL run produced 124 rows overall, 11 baseline, 58 hold
   and 12 cooldown rows. The largest UTC gap was **6.576 s**, with no sampler
   error/warning. Analysis checks the actual phase coverage and gaps rather
   than assuming exactly 60 hold rows. No missing values were filled in.
3. **The orphan verifier was repeated after a shell assertion correction.**
   Docker 29.9 reported lowercase `no such object`; the first case-sensitive
   grep stopped after successful recovery. That evidence is retained under
   diagnostics. The repeated check used a case-insensitive match and recorded
   the complete PID/container/timestamp/boot-log result.
4. **All 20 live sandbox configurations were inspected during the hold.**
   They retained 256 MiB memory/no extra swap, 0.5 CPU, 128 PIDs, cap-drop ALL,
   basic capabilities, no-new-privileges, network none, no mounts and no
   privileged mode. The effective kernel limit probe and 27 targeted rootless
   Docker tests passed before the rerun. `pnpm verify` passed 513 tests.
5. **Original machine state was restored.** The temporary `.wslconfig` was
   removed because none existed originally; Docker Desktop again reports 12
   processors. Both previously running Solaris containers were restarted. The
   test app/daemon were stopped, and the installed test distro is stopped but
   retained for reuse. See `restoration.txt`.

## 5. Conclusions & follow-ups
**T9.2 passes for this WSL target with `MAX_CONTAINERS=20`.** Keep the existing
256-MiB/0.5-CPU/128-PID per-container settings and the D-057 PID-scope correction.
No other resource adjustment was needed.

This run covers w1-01 PTY typing with incomplete objectives, then reference
completion, cleanup, idle expiry and boot orphan recovery. It does not measure
CPU-heavy player programs, worst-case memory consumption, LAN/admin levels,
internet latency, a cloud VM or Caddy/TLS. There is no measured basis here for
raising capacity above 20 or choosing a different isolation runtime. Benchmark
the eventual hosting environment separately; T9.3 remains unstarted and public
deployment is still gated by its actual-host checks.
