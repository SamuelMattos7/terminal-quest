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

Implement a script `tools/scripts/loadtest.ts` (part of T9.2) that:
1. Creates N guest users (`POST /api/guest`, keep each cookie jar).
2. Each virtual user starts `w1-01-first-words`, connects the WebSocket, then repeatedly:
   - sends `echo test` / `ls` / `pwd` keystrokes every 2–5 s (random jitter) for 5 minutes,
   - measures time from sending a command to receiving the matching output chunk (echo latency),
   - then completes the level by running the reference commands and records time to `level_complete`.
3. Ramps from 1 → 20 users over 60 s, holds for 5 min, then sends a 21st `start` and records the response code.
4. All users leave (`DELETE /api/sessions/:id`) and the script waits 60 s.

Sampling during the run (every 5 s, written to CSV):
```bash
docker stats --no-stream --format '{{.Name}},{{.CPUPerc}},{{.MemUsage}}'
free -m ; uptime
docker ps -q --filter label=tq.managed=true | wc -l
```
Post-run checks:
```bash
docker ps -a --filter label=tq.managed=true            # expect empty
docker network ls --filter label=tq.managed=true       # expect empty
```
Also run one **idle expiry** check (leave a session idle past `IDLE_TTL_SECONDS` with a shortened TTL) and one **server restart** check (restart server mid-test; verify the orphan sweep removes leftover sandboxes).

## 4. Results (fill in after running)

### 4.1 Capacity & cleanup
| Check | Expected | Observed |
|---|---|---|
| Concurrent sessions sustained | 20 | |
| 21st start response | 429 + Retry-After | |
| Leftover containers after run | 0 | |
| Leftover networks after run | 0 | |
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
