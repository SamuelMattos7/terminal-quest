#!/bin/bash
set -eu
RANDOM=$TQ_SEED

cd /home/player
codes=(200 302 404 503)
offset=$((RANDOM % 4))
counts=("$((12 + RANDOM % 5))" "$((7 + RANDOM % 3))" "$((4 + RANDOM % 3))" "$((1 + RANDOM % 3))")

for ((row = 0; row < counts[0]; row++)); do
  for ((rank = 3; rank >= 0; rank--)); do
    if ((row < counts[rank])); then
      printf '192.0.2.%d|%d|/request/%d\n' "$((10 + row))" "${codes[(offset + rank) % 4]}" "$row"
    fi
  done
done > access.log
chmod 644 access.log

mkdir -p /opt/tq/secret
umask 077
for ((rank = 0; rank < 3; rank++)); do
  printf '%d %d\n' "${counts[rank]}" "${codes[(offset + rank) % 4]}"
done > /opt/tq/secret/top3
