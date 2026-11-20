"""Per-attempt manager for a small, unprivileged service and timer simulation."""

import configparser
import json
import os
import pwd
import shlex
import signal
import socketserver
import subprocess
import time
from datetime import datetime, timezone

from tq_systemd_units import (
    JOURNAL_DIR, RUNTIME_DIR, SOCKET, UNIT_DIR, UNIT_NAME,
    Service, Timer, journal_path, load_unit, service_account,
)


class Manager:
    def __init__(self):
        self.player = pwd.getpwnam("player")
        self.units: dict[str, Service | Timer] = {}
        self.processes: dict[str, subprocess.Popen] = {}
        self.results: dict[str, int] = {}
        self.restarts: dict[str, float] = {}
        self.timers: dict[str, datetime] = {}
        self.enabled_dir = RUNTIME_DIR / "enabled"
        self.enabled_dir.mkdir(exist_ok=True)

    def reload(self):
        units = {}
        for path in sorted(UNIT_DIR.iterdir()):
            if not UNIT_NAME.fullmatch(path.name):
                continue
            try:
                units[path.name] = load_unit(path)
            except (OSError, ValueError, KeyError, configparser.Error) as error:
                raise ValueError(f"{path.name}: {error}") from error
        now = datetime.now(timezone.utc)
        self.timers = {
            name: unit.next_after(now)
            for name in self.timers
            if isinstance(unit := units.get(name), Timer)
        }
        self.units = units

    def journal(self, unit, message):
        with journal_path(unit).open("a", encoding="utf-8") as log:
            print(message, file=log)

    def launch(self, name, service):
        if name in self.processes:
            return
        self.restarts.pop(name, None)
        try:
            account = service_account(service.user)
            with journal_path(name).open("ab") as log:
                self.processes[name] = subprocess.Popen(
                    service.command,
                    stdin=subprocess.DEVNULL, stdout=log, stderr=log,
                    cwd="/", start_new_session=True,
                    user=account.pw_uid, group=account.pw_gid, extra_groups=[],
                    env={"HOME": account.pw_dir, "USER": service.user, "LOGNAME": service.user,
                         "PATH": "/usr/bin:/bin", "LANG": "C.UTF-8"},
                )
        except (OSError, ValueError) as error:
            self.record_exit(name, 1)
            self.journal(name, f"ExecStart failed: {error}")
            raise
        self.results.pop(name, None)

    def record_exit(self, name, code):
        self.results[name] = code
        unit = self.units.get(name)
        if code != 0 and isinstance(unit, Service) and unit.restart_on_failure:
            self.restarts[name] = time.monotonic() + 1

    def start(self, name, unit):
        if isinstance(unit, Service):
            self.launch(name, unit)
        elif name not in self.timers:
            if not isinstance(self.units.get(unit.service), Service):
                raise ValueError(f"load {unit.service} before starting {name}")
            self.timers[name] = unit.next_after(datetime.now(timezone.utc))

    def stop(self, name):
        self.timers.pop(name, None)
        self.restarts.pop(name, None)
        self.results.pop(name, None)
        job = self.processes.pop(name, None)
        if job is not None:
            signal_group(job, signal.SIGTERM)
            try:
                job.wait(timeout=0.5)
            except subprocess.TimeoutExpired:
                pass
            signal_group(job, signal.SIGKILL)
            job.wait(timeout=0.5)

    def tick(self):
        for name, job in list(self.processes.items()):
            code = job.poll()
            if code is not None:
                signal_group(job, signal.SIGKILL)
                del self.processes[name]
                self.record_exit(name, code)

        for name, at in list(self.restarts.items()):
            if at <= time.monotonic():
                del self.restarts[name]
                self.start_from_tick(name)

        now = datetime.now(timezone.utc)
        for name, at in self.timers.items():
            unit = self.units[name]
            if at <= now:
                self.timers[name] = unit.next_after(now)
                self.start_from_tick(unit.service)

    def start_from_tick(self, name):
        unit = self.units.get(name)
        if isinstance(unit, Service):
            try:
                self.launch(name, unit)
            except (OSError, ValueError):
                # launch already journaled the failure and applied Restart.
                pass

    def status(self, name, unit):
        enabled = "enabled" if (self.enabled_dir / name).exists() else "disabled"
        if isinstance(unit, Timer):
            at = self.timers.get(name)
            state = "active (waiting)" if at is not None else "inactive (dead)"
            details = [f"OnCalendar: {unit.calendar}", f"Triggers: {unit.service}"]
            if at is not None:
                details.append(f"Next: {at.isoformat(timespec='seconds')}")
        else:
            job = self.processes.get(name)
            code = self.results.get(name)
            details = [f"User: {unit.user}", f"ExecStart: {shlex.join(unit.command)}"]
            if job is not None:
                state = "active (running)"
                details.append(f"Main PID: {job.pid}")
            elif name in self.restarts:
                state = "activating (auto-restart)"
            elif code not in (0, None):
                state = "failed"
            else:
                state = "inactive (dead)"
            if code is not None:
                details.append(f"Result: exit {code}")
        return "\n".join([name, f"Loaded: loaded ({enabled})", f"Active: {state}", *details])

    def dispatch(self, args):
        if args == ["daemon-reload"]:
            self.reload()
            return ""
        if args == ["list-timers"]:
            rows = ["NEXT (UTC)                 UNIT                  ACTIVATES"]
            for name, at in sorted(self.timers.items(), key=lambda item: (item[1], item[0])):
                rows.append(f"{at.isoformat(timespec='seconds')}  {name}  {self.units[name].service}")
            return "\n".join(rows)

        if len(args) != 2 or args[0] not in (
            "start", "stop", "restart", "status", "enable", "disable"
        ) or not UNIT_NAME.fullmatch(args[1]):
            raise ValueError("expected a command and a .service or .timer unit name")
        command, name = args
        unit = self.units.get(name)
        if command == "stop" and (name in self.processes or name in self.restarts):
            self.stop(name)
            return ""
        if unit is None:
            raise ValueError(f"unit {name} is not loaded; run systemctl daemon-reload")

        if command == "status":
            return self.status(name, unit)
        if command in ("stop", "restart"):
            self.stop(name)
        if command in ("start", "restart"):
            self.start(name, unit)
        if command == "enable":
            (self.enabled_dir / name).touch()
        if command == "disable":
            (self.enabled_dir / name).unlink(missing_ok=True)
        return ""


def signal_group(job, signum):
    try:
        os.killpg(job.pid, signum)
    except ProcessLookupError:
        pass


class Request(socketserver.StreamRequestHandler):
    timeout = 1

    def handle(self):
        try:
            request = self.rfile.readline(1025)
            if len(request) > 1024:
                raise ValueError("command is too long")
            args = json.loads(request)
            if not isinstance(args, list) or not all(isinstance(arg, str) for arg in args):
                raise ValueError("invalid command")
            response = [0, self.server.manager.dispatch(args)]
        except (ValueError, OSError, subprocess.TimeoutExpired) as error:
            response = [1, str(error)]
        try:
            self.wfile.write(json.dumps(response).encode() + b"\n")
        except (BrokenPipeError, ConnectionResetError):
            pass


def main():
    os.umask(0o022)
    manager = Manager()
    manager.reload()
    with socketserver.UnixStreamServer(str(SOCKET), Request) as server:
        server.manager = manager
        os.chown(SOCKET, 0, manager.player.pw_gid)
        os.chmod(SOCKET, 0o660)
        server.timeout = 0.1
        while True:
            manager.tick()
            server.handle_request()


if __name__ == "__main__":
    main()
