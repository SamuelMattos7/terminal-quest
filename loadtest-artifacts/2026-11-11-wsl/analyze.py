"""Recompute run-02 measurements from the retained raw evidence (stdlib only)."""

import csv
import json
import statistics
from datetime import datetime, timedelta
from pathlib import Path

root = Path(__file__).resolve().parent
run = json.loads((root / "run-02.json").read_text(encoding="utf-8-sig"))
meta = json.loads((root / "run-02" / "host.csv.meta.json").read_text())
with (root / "run-02" / "host.csv").open(newline="") as source:
    rows = list(csv.DictReader(source))


def timestamp(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def window(start, end):
    return [row for row in rows if start <= timestamp(row["at"]) < end]


def median(samples, field):
    return statistics.median(float(row[field]) for row in samples)


baseline_start = timestamp(meta["startedAt"])
baseline_end = baseline_start + timedelta(seconds=60)
baseline = window(baseline_start, baseline_end)
hold_start = timestamp(run["holdStartedAt"])
hold_end = timestamp(run["holdEndedAt"])
hold = window(hold_start, hold_end)
cleanup_start = timestamp(run["cleanupRequestedAt"])
cleanup_end = cleanup_start + timedelta(seconds=60)
cooldown = window(cleanup_start, cleanup_end)
assert len(baseline) >= 10 and hold and len(cooldown) >= 11
# A scheduled 5 s timer is not an exact UTC sample count on a shared WSL VM.
# Check actual coverage and gaps, and report the observed cadence explicitly.
gaps = [(timestamp(b["at"]) - timestamp(a["at"])).total_seconds() for a, b in zip(rows, rows[1:])]
assert max(gaps) < 10, "missing more than one nominal sampling interval"
assert timestamp(hold[0]["at"]) - hold_start < timedelta(seconds=10)
assert hold_end - timestamp(hold[-1]["at"]) < timedelta(seconds=10)
assert all(int(row["managedTotal"]) == 0 for row in baseline)
assert run["status"].startswith("client checks passed")
assert meta["logicalCpus"] == 4 and 7 * 1024**3 < meta["memoryBytes"] <= 8 * 1024**3
assert 'rootless' in meta["dockerMode"] and 'cgroup=2' in meta["dockerMode"]
assert baseline_end < timestamp(run["rampStartedAt"])
assert run["workloadPassed"] and run["latencyTargetsPassed"]
assert run["holdDurationMs"] >= 300_000
assert run["latencies"]["start"]["count"] == 20
assert run["latencies"]["completion"]["count"] == 20
assert run["cleanupErrors"] == []
assert all(int(row["managedRunning"]) == 20 and int(row["managedTotal"]) == 20 for row in hold)
assert all(int(row["managedTotal"]) == 0 for row in cooldown)

summary = {
    "sourceCommit": meta["commit"],
    "baselineWindowUtc": [baseline_start.isoformat(), baseline_end.isoformat()],
    "holdWindowUtc": [hold_start.isoformat(), hold_end.isoformat()],
    "cooldownWindowUtc": [cleanup_start.isoformat(), cleanup_end.isoformat()],
    "sampleCounts": {"total": len(rows), "baseline": len(baseline), "hold": len(hold), "cooldown": len(cooldown)},
    "holdDurationMs": run["holdDurationMs"],
    "latencies": run["latencies"],
    "capacity": run["capacity"],
    "peakHostCpuPct": max(float(row["hostCpuPct"]) for row in rows),
    "peakHostUsedMiB": max(float(row["hostUsedMiB"]) for row in rows),
    "peakServerRssMiB": max(float(row["serverRssMiB"]) for row in rows),
    "peakManagedTotal": max(int(row["managedTotal"]) for row in rows),
    "largestSamplingGapSeconds": max(gaps),
}
for field, name in [("hostUsedMiB", "hostUsedMiB"), ("serverRssMiB", "serverRssMiB")]:
    before, after = median(baseline, field), median(cooldown, field)
    summary[name] = {"baselineMedian": before, "cooldownMedian": after, "delta": after - before}

summary["holdHostUsedMiB"] = {
    "firstMinuteMedian": median(window(hold_start, hold_start + timedelta(seconds=60)), "hostUsedMiB"),
    "lastMinuteMedian": median(window(hold_end - timedelta(seconds=60), hold_end), "hostUsedMiB"),
}
summary["resourceTargetsPassed"] = (
    summary["peakHostUsedMiB"] * 1024 * 1024 < 6_000_000_000
    and summary["hostUsedMiB"]["delta"] <= 256
    and summary["serverRssMiB"]["delta"] <= 32
    and summary["peakManagedTotal"] == 20
)
assert summary["resourceTargetsPassed"], summary
idle = json.loads((root / "idle.json").read_text())
orphan = json.loads((root / "orphan" / "result.json").read_text())
assert idle["idleExpired"] and idle["cleanupErrors"] == []
assert idle["status"].startswith("client checks passed")
assert 28_000 <= idle["idleWaitMs"] <= 75_000
assert orphan["orphanRemoved"] and orphan["managedRemaining"] == 0
assert orphan["beforePid"] != orphan["afterPid"] and orphan["ttlSeconds"] == 900
summary["recovery"] = {
    "idleWaitMs": idle["idleWaitMs"],
    "orphanRecoverySeconds": (timestamp(orphan["recoveredAt"]) - timestamp(orphan["crashedAt"])).total_seconds(),
}
assert summary["recovery"]["orphanRecoverySeconds"] <= 60
live = [json.loads(line) for line in (root / "run-02" / "under-load-containers.jsonl").read_text().splitlines()]
assert len(live) == 20
for sandbox in live:
    assert sandbox["pidsLimit"] == 128 and sandbox["memory"] == sandbox["memorySwap"] == 268435456
    assert sandbox["nanoCpus"] == 500000000 and sandbox["network"] == "none"
    assert sandbox["capDrop"] == ["ALL"] and sandbox["securityOpt"] == ["no-new-privileges"]
    assert not sandbox["mounts"] and not sandbox["privileged"]
summary["combinedChecksPassed"] = True
(root / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
print(json.dumps(summary, indent=2))
