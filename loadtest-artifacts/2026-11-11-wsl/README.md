# T9.2 WSL evidence — 2026-11-11 (America/Santiago)

Raw timestamps use UTC, so the run files are dated 2026-11-12 UTC. The Windows
load generator and Ubuntu WSL target ran on the same physical Ryzen 5 5600 PC.
WSL was temporarily limited to four processors, 8 GB RAM and zero swap. Docker
Desktop and its two pre-existing containers were stopped with user approval.

- `windows.json`: Windows/WSL inventory, generator transport and the original configuration state.
- `run-01.json`, `driver-01.log`, `run-01/`: failed first ramp on `e7246c7`, including resource sampling and preflight.
- `diagnostics/`: the one-process nproc reproduction and two failing regressions against the original profile.
- `docker-fix-tests.log`: 27 real-container tests passed on rootless WSL after the D-057 correction.
- `docker-desktop-regressions.log`: the same 27 tests passed on restored rootful Docker Desktop.
- `run-02.json`, `driver-02.log`, `run-02/`: complete measured rerun on `3b71d9e`, its raw host CSV/metadata, environment and cleanup evidence.
- `idle.json`, `idle/`: shortened-TTL client result, service configuration/state and idle-expiry logs.
- `orphan/`: original container/session identity, old/new server PIDs, SIGKILL/restart timestamps, container-not-found proof and the boot-sweep log.
- `summary.json`: measurements recomputed by `python analyze.py` using Python's standard library.
- `restoration.txt`: original global WSL configuration restored, Desktop back to 12 processors, both pre-existing containers running and the test distro stopped.

The analysis uses the sampler's first 60 seconds as baseline, the full-load
hold for 20-session continuity, and the first 60 seconds after deletion for
memory recovery. It asserts workload counts, capacity response, full-load
container counts, zero post-run containers, latency and recovery thresholds.
Recovery logs separately establish idle expiry and abrupt-restart cleanup.
The five-second sampler had observed UTC gaps up to 6.576 s: there are 58 hold
rows, not an assumed 60. The analysis checks actual gap/phase coverage and
reports the observed count. No missing measurements are synthesized.

Client JSON deliberately leaves `targetVmVerified` false: the client alone
cannot certify host isolation, resource enforcement or recovery. The combined
preflight, kernel regressions, samples and recovery evidence support the
assessment in `../../loadtest.md`.

This is a local WSL capacity result, not a cloud-host benchmark or a T9.3
HTTPS/deployment rehearsal. The workload measures PTY input echo while the
level remains incomplete, followed by the two reference commands. It does not
simulate CPU-heavy player programs or internet client latency.
