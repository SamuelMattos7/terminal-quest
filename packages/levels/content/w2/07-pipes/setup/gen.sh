#!/bin/bash
set -eu
RANDOM=$TQ_SEED

cd /home/player
unique_ips=$((5 + RANDOM % 8))
first_host=$((10 + RANDOM % 200))
for path in /health /status /metrics; do
  for ((i = 0; i < unique_ips; i++)); do
    printf '192.0.2.%d GET %s 200\n' "$((first_host + i))" "$path"
  done
done > access.log
chmod 644 access.log

mkdir -p /opt/tq/secret
umask 077
printf '%d\n' "$unique_ips" > /opt/tq/secret/unique_ips
