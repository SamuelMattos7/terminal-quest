#!/usr/bin/env python3
"""cronmatch.py — semantic cron schedule equivalence (plan.md §8.2, D-008).

Usage: cronmatch.py '<schedule-a>' '<schedule-b>' [--count N]
Exit 0 when both schedules fire at the same times, 1 when they differ,
2 on usage errors or unparseable schedules.

Schedules are 5-field expressions or aliases (@yearly, @annually, @monthly,
@weekly, @daily, @midnight, @hourly, @reboot). @reboot only equals @reboot.
Equivalence is decided by comparing the next COUNT fire times (default 10)
from a fixed epoch — plenty for level schedules; exotic schedules that only
diverge beyond the horizon would compare equal (documented limitation).
"""

import sys
from datetime import datetime, timezone

try:
    from croniter import croniter
except ImportError:
    print("cronmatch.py: python3-croniter is not installed", file=sys.stderr)
    sys.exit(2)

ALIASES = {
    "@yearly": "0 0 1 1 *",
    "@annually": "0 0 1 1 *",
    "@monthly": "0 0 1 * *",
    "@weekly": "0 0 * * 0",
    "@daily": "0 0 * * *",
    "@midnight": "0 0 * * *",
    "@hourly": "0 * * * *",
}

EPOCH = datetime(2026, 1, 1, tzinfo=timezone.utc)


def expand(schedule: str) -> str | None:
    text = schedule.strip()
    if text == "@reboot":
        return None
    if text.startswith("@"):
        expanded = ALIASES.get(text.lower())
        if expanded is None:
            raise ValueError(f"unknown alias: {schedule}")
        return expanded
    return text


def fire_times(schedule: str, count: int) -> list[datetime]:
    expr = expand(schedule)
    if expr is None:
        raise ValueError("@reboot has no calendar fire times")
    try:
        it = croniter(expr, EPOCH)
    except Exception as exc:
        raise ValueError(f"bad schedule {schedule!r}: {exc}") from exc
    try:
        return [it.get_next(datetime) for _ in range(count)]
    except Exception as exc:
        raise ValueError(f"bad schedule {schedule!r}: {exc}") from exc


def main(argv: list[str]) -> int:
    rest = argv[1:]
    count = 10
    schedules: list[str] = []
    i = 0
    while i < len(rest):
        if rest[i] == "--count":
            if i + 1 >= len(rest):
                print("cronmatch.py: --count needs an integer", file=sys.stderr)
                return 2
            try:
                count = int(rest[i + 1])
            except ValueError:
                print("cronmatch.py: --count needs an integer", file=sys.stderr)
                return 2
            i += 2
        else:
            schedules.append(rest[i])
            i += 1
    if len(schedules) != 2 or count < 1:
        print("usage: cronmatch.py '<schedule-a>' '<schedule-b>' [--count N]", file=sys.stderr)
        return 2
    a, b = schedules[0].strip(), schedules[1].strip()
    if a == "@reboot" or b == "@reboot":
        return 0 if a.lower() == b.lower() == "@reboot" else 1
    try:
        return 0 if fire_times(a, count) == fire_times(b, count) else 1
    except ValueError as exc:
        print(f"cronmatch.py: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
