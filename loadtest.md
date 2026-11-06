# Load Test Report — Terminal Quest

> **Status: TEMPLATE — NOT YET RUN.** This file describes how to run the test (task T9.2) and has empty result tables. Do not fill in numbers you didn't measure. The task is complete only when the results below come from a real run.

## 1. Goal

Confirm that one VM can host the target number of concurrent sandboxes, that the capacity cap behaves, and that cleanup keeps resource usage stable.

**Targets (from plan §15 T9.2):**
- 20 concurrent active sessions on a 4 vCPU / 8 GB box with `MAX_CONTAINERS=20`
- The 21st `start` request gets HTTP 429 with a `Retry-After` header
- After sessions end, no sandbox containers/networks remain; memory returns near baseline
- Median keystroke-to-echo latency < 100 ms; sandbox start time p95 < 5 s

## 2. Test environment (fill in)

| Item | Value |
|---|---|
| VM provider / type | |
| vCPU / RAM / disk | |
| OS / kernel | |
| Docker mode (rootless? runtime?) | |
| Node version | |
| Commit SHA | |
| Config (`MAX_CONTAINERS`, TTLs, `ENABLE_WORLDS`) | |

## 3. Procedure

Set up the target VM using the [draft deployment guide](deploy.md). Record the
commit, use `ENABLE_WORLDS=1` for current content, and confirm
`/healthz` reports `docker:true` before starting the run.

Implement a script `tools/scripts/loadtest.ts` (part of T9.2) that:
1. Creates 21 distinct guests with `POST /api/guest` and keeps each session cookie. Spread launches over the ramp so the per-IP HTTP rate limit does not mask the sandbox capacity test.
2. Starts 20 guests over 60 s via `POST /api/levels/w1-01-first-words/start`. Records start request latency and opens each returned `wsPath` with that guest's cookie and the configured public Origin.
3. Holds 20 sessions open for five minutes. Sends terminal input every 2–5 s and measures the time until a distinct input marker is echoed by the PTY. Match markers across output frames. Use commands that leave the level incomplete during the hold.
4. While all 20 sessions are active, starts the level as the 21st guest. Records HTTP 429, `Retry-After`, and the `sandbox capacity reached` response to distinguish it from HTTP rate limiting.
5. Runs the reference commands and records time to `level_complete`. Closes any remaining sessions with `DELETE /api/sessions/:sessionId` and waits 60 s before checking cleanup.

Sampling during the run (every 5 s, written to CSV):
```bash
docker stats --no-stream --format '{{.Name}},{{.CPUPerc}},{{.MemUsage}}'
free -m ; uptime
docker ps -q --filter label=tq.managed=true | wc -l
```
Post-run checks:
```bash
docker ps -a --filter label=tq.managed=true            # expect empty
# LAN cleanup belongs to T10.2 once per-attempt networks exist.
```
Also run one **idle expiry** check (leave a session idle past `IDLE_TTL_SECONDS` with a shortened TTL) and one **orphan recovery** check (interrupt the server without graceful shutdown on the test VM, restart it, and verify the boot sweep removes leftover managed containers).

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

### 4.3 Observations & issues
_Anything that failed, was slow, or surprised you; link to related entries in `DECISIONS.md` or `PROGRESS.md → Known gaps`._

## 5. Conclusions & follow-ups
_Recommended `MAX_CONTAINERS` for this VM size, resource limits adjustments, whether gVisor/microVM is needed, etc._
