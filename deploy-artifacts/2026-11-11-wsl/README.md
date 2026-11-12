# T9.3 fresh WSL deployment evidence

Run date: **2026-11-11, America/Santiago**. Raw JSON timestamps use November 12
UTC. Branch `codex/t9-3-clean-deployment` starts at `b3ad116` from
`codex/t9-2-load-test`. The fresh checkout initially ran `b3ad116`; the documented
upgrade fast-forwarded to `533abaf`. Both revisions have identical application,
schema and sandbox-image source; the upgrade exercised the complete operational
procedure with existing data, not a new schema migration.

The newly downloaded **TerminalQuest-T93** distro is Ubuntu 24.04.5 x86-64 on
WSL 2.6.3 / kernel 6.6.87.2. It started without a `tq` user, Linux Docker, Node,
application checkout, database or image cache. Windows' Docker CLI appeared in
the inherited PATH, so setup used an explicit Linux PATH and installed Linux
Docker independently. Installed versions: Node **24.22.3**, pnpm **9.15.9**,
Docker **29.9.3**, Caddy **2.11.9**. No T9.2 images, dependencies or database were
imported. A source-only Git bundle populated a local bare origin in the distro.

## Results

| Check | Evidence | Result |
| --- | --- | --- |
| Fresh package/user installation | `install.log`, `build.log`, `build-retry.log` | Dedicated uid 1000; subordinate uid/gid ranges; official Docker/Caddy repositories; SHA-256-checked Node archive; frozen dependencies; fresh app/image build |
| Real systemd configuration and migration | `service.log`, `final-checks.log` | Units/environment extracted from `deploy.md`; correct `/home/tq/data/tq.sqlite`; non-root Node; no-new-privileges; restrictive service umask; separate migration with umask 077 created mode 600 |
| Rootless isolation and effective limits | `build-retry.log`, `https-smoke-final.log`, `final-checks.log`, `caddy.log` | Rootless/systemd/cgroup v2; actual sandbox cgroup files report 268435456 bytes, `50000 100000`, 128 PIDs; network none, all capabilities dropped, no-new-privileges, zero mounts; Docker socket only Unix, app only loopback |
| HTTPS/SPA/assets/security | `https-smoke-final.log`, `caddy.log` | Strict local-CA verification; HTML for `/`, `/map`, `/profile`; JS/CSS/WOFF2 delivery; missing asset 404; unauthenticated API remains 401; CSP, HSTS, nosniff, referrer policy; Secure/HttpOnly/SameSite=Lax cookie |
| Real WebSocket play | `https-smoke-final.log` | Authenticated connection through Caddy; shell execution readiness; `w1-01` clear, S / 55 XP; API-confirmed saved progress; zero managed containers after deletion |
| Graceful stop with active attempt | `shutdown.log`, `recovery-journal.log` | `closing:server_shutdown`; DB status abandoned with end timestamp; zero managed containers |
| Crash and boot sweep | `orphan.log`, `recovery-journal.log` | Main PID 744 killed; its sandbox observed surviving; automatic restart PID 922; journal confirms exactly one boot orphan removed; zero leftovers |
| Distro restart without manual starts | `before-reboot.log`, `after-reboot.log`, `progress-after-reboot.log` | Init start changed 22:26:13 → 22:26:17; Caddy/user-manager invocation IDs changed; enabled Docker/app/timer all active; original guest still has one completion / 55 XP |
| Scheduled backup | `backup-timer.log`, `backup-final.log` | A temporary timer drop-in scheduled a five-second trigger. Journal confirms oneshot completion at 22:23:40; backup mode 600, integrity `ok`, saved completion present. Drop-in removed; nightly 03:00 / Persistent=true restored |
| Retrieval and scratch restore | `off-distro-copy.json`, `restore.log` | Windows retrieved 122880 bytes. SHA-256 matches returned Linux copy; scratch `.restore` integrity `ok`; saved rank/XP/completion rows match the live DB |
| Real fast-forward upgrade | `upgrade.log`, `progress-after-upgrade.log`, `https-after-upgrade.log` | Exact guide block stopped service, made unique pre-upgrade backup, pulled, installed, rebuilt app/image, migrated and restarted. Original guest/progress survived; a fresh HTTPS WebSocket clear passed |
| Verification | `baseline-retry.log`, `verify-before-upgrade.log`, `verify-linux.log`, `verify-final.log`, `final-checks.log` | Full build/lint and 513 tests on Windows and 513 on Linux; all 18 Bash blocks passed `bash -n`; systemd app/backup units verified |
| Environment preservation | `windows-inventory.txt`, `cleanup.txt` | Global `.wslconfig` remains absent; T9.2 remains stopped; both pre-existing Solaris Desktop containers remained running; T9.3 retained stopped after cleanup |

## Corrections and unsuccessful checks

Evidence is retained rather than deleting initial failures:

- The first sandboxed pnpm invocation could not resolve the package registry and
  ran no checks. The first host baseline (`baseline-first.log`) passed build/lint
  and 497 tests before one worker exited unexpectedly. The unchanged retry and
  later Windows/Linux verifications passed all 513; no tests were weakened.
- The provisioning helper's final line had a Windows CR suffix and attempted to
  read `/etc/subgid\r` after all installations completed. Subsequent Linux checks
  confirmed both subordinate ranges. Helper scripts were normalized to LF.
- The first local bare origin was administrator-owned. Git rejected its dubious
  ownership (`build.log`); assigning this rehearsal-only origin to `tq` allowed
  the clean clone (`build-retry.log`). No global safe-directory exception was used.
- The first HTTPS evidence client read socket metadata after Node detached the
  socket (`https-smoke.log`). It now captures authorization at response start.
  The second check incorrectly expected unauthenticated `/api/missing` to return
  404 (`https-smoke-retry.log`); the documented auth boundary correctly returns
  401. The corrected client passed without application changes.
- The timer observer checked for the backup while its oneshot was still starting
  (`backup-timer.log`). The completed service/journal, actual file, integrity and
  saved rows are in `backup-final.log`. The nightly configuration was restored.
- The initial migration created a mode-644 database inside `tq`'s private home.
  The guide now applies umask 077 to migration; a fresh scratch migration proved
  mode 600 (`final-checks.log`), and the rehearsal database was restricted to 600.
- Caddy briefly returned 502 during boot/upgrade while Node initialized. Health
  retries reached `{ok:true,docker:true}`. The guide now explains this interval.

`verify.mjs` is the executed operational client, run as `tq`, with dependencies
resolved from the Linux checkout. Modes are `smoke`, `shutdown`, `orphan` and
`progress`. It validates application payloads with shared schemas, sends shell
commands only through the sandbox WebSocket, and emits no cookies or terminal
streams. Its private guest state was kept outside the repository and removed
after testing. No database, cookie, private CA key or dependency/image archive is
included in this evidence directory.

## Scope

This completes the user's **fresh WSL 2** deployment rehearsal and demonstrates
the corrected guide is followable. Caddy uses loopback-only `https://localhost`
and its internal CA; the client verifies that CA rather than bypassing TLS.
Public DNS, ACME issuance, internet ingress/firewalls, a future host's security
and capacity, Windows reboot/autostart, and remote SSH/off-device backup storage
were not verified. D-054's eventual production-host prerequisite remains.

The shared WSL kernel boot ID remained unchanged because Docker Desktop was
running. New distro init/service timestamps and invocation IDs demonstrate the
explicit distro restart. WSL also shut the distro down between some invocations:
[systemd services alone do not keep WSL alive](https://learn.microsoft.com/en-us/windows/wsl/systemd).
The guide documents this; it does not claim always-on hosting. The accelerated
timer proves actual scheduling/backup execution, not a wall-clock overnight soak.
The Windows backup copy survives loss of the distro, not loss of the computer.
