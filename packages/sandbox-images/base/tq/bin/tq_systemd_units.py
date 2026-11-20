"""Unit file subset for the Terminal Quest systemd simulation."""

import configparser
import os
import pwd
import re
import shlex
import stat
from dataclasses import dataclass
from datetime import datetime, time, timedelta
from pathlib import Path

UNIT_DIR = Path("/etc/systemd/system")
RUNTIME_DIR = Path("/run/tq/systemd")
SOCKET = RUNTIME_DIR / "control"
JOURNAL_DIR = Path("/var/log/tq-journal")
UNIT_NAME = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,100}\.(service|timer)")


@dataclass(frozen=True)
class Service:
    command: tuple[str, ...]
    user: str
    restart_on_failure: bool


@dataclass(frozen=True)
class Timer:
    service: str
    calendar: str
    at: time

    def next_after(self, now: datetime) -> datetime:
        if self.calendar == "hourly":
            return now.replace(minute=0, second=0, microsecond=0) + timedelta(hours=1)
        today = datetime.combine(now.date(), self.at, tzinfo=now.tzinfo)
        return today if today > now else today + timedelta(days=1)


def service_account(user: str) -> pwd.struct_passwd:
    try:
        account = pwd.getpwnam(user)
    except KeyError as error:
        raise ValueError(f"unknown service user: {user}") from error
    if account.pw_uid < 1000 or account.pw_gid == 0:
        raise ValueError("User must be an ordinary non-root sandbox account")
    return account


def load_unit(path: Path) -> Service | Timer:
    # The player authors these files. Refuse symlinks and special files, and
    # bound the read so a pipe or oversized unit cannot stall the manager.
    config = configparser.ConfigParser(interpolation=None)
    with os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK),
                   encoding="utf-8") as unit:
        if not stat.S_ISREG(os.fstat(unit.fileno()).st_mode):
            raise ValueError("unit must be a regular file")
        content = unit.read(16_385)
    if len(content) > 16_384:
        raise ValueError("unit exceeds 16 KiB")
    config.read_string(content)

    if path.suffix == ".service":
        fields = config["Service"]
        if fields.get("Type", "simple") != "simple":
            raise ValueError("the simulation supports Type=simple")
        user = fields.get("User", "player")
        service_account(user)
        exec_start = fields["ExecStart"]
        if any(char in exec_start for char in "\n\r\0"):
            raise ValueError("ExecStart must be on one line")
        command = tuple(shlex.split(exec_start))
        if not command or not command[0].startswith("/"):
            raise ValueError("ExecStart needs an absolute command path")
        restart = fields.get("Restart", "no")
        if restart not in ("no", "on-failure"):
            raise ValueError("Restart must be no or on-failure")
        return Service(command, user, restart == "on-failure")

    fields = config["Timer"]
    service = fields.get("Unit", f"{path.stem}.service")
    if not UNIT_NAME.fullmatch(service) or not service.endswith(".service"):
        raise ValueError("Unit must name a .service file")
    calendar = fields["OnCalendar"]
    if calendar in ("daily", "hourly"):
        return Timer(service, calendar, time())
    match = re.fullmatch(r"\*-\*-\* ([0-9]{2}:[0-9]{2}:[0-9]{2})", calendar)
    if match is None:
        raise ValueError("OnCalendar must be daily, hourly, or *-*-* HH:MM:SS")
    return Timer(service, calendar, time.fromisoformat(match[1]))


def journal_path(unit: str) -> Path:
    return JOURNAL_DIR / f"{unit}.log"
