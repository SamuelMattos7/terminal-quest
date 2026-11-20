#!/bin/bash
set -eu
RANDOM=$TQ_SEED
install -d -o player -g player /tmp/tq-load-ready
umask 077
workloads=(cpu memory io)
offset=$((RANDOM % 3))
for slot in 0 1 2; do
  kind=${workloads[(slot + offset) % 3]}
  name="tq-load-$RANDOM-$slot"
  runuser -u player -- env TQ_LOAD="$kind" bash -c 'exec -a "$1" /usr/bin/python3 /opt/tq/triage-load.py' bash "$name" </dev/null >/dev/null 2>&1 &
  case "$kind" in cpu) label=CPU;; memory) label=MEM;; io) label=IO;; esac
  printf '%s=%s\n' "$label" "$name" > "/opt/tq/secret/triage-$kind"
done
for attempt in {1..90}; do
  ready=$(find /tmp/tq-load-ready -type f | wc -l)
  [[ $ready -eq 3 ]] && break
  sleep .03
done
test "$ready" -eq 3
runuser -u player -- bash -c 'exec -a tq-sentinel sleep 600' </dev/null >/dev/null 2>&1 &
