#!/bin/bash
set -eu
RANDOM=$TQ_SEED

cd /home/player
mkdir -p /opt/tq/secret
errors=$((3 + RANDOM % 7))
error_labels=(ERROR Error error)
printf 'INFO health check passed\nWARN previous ERROR was resolved\n' > app.log
for ((i = 0; i < errors; i++)); do
  printf '%s worker %d timed out\n' "${error_labels[i % 3]}" "$i"
  printf 'INFO worker %d restarted\n' "$i"
done >> app.log

port=$((8000 + RANDOM % 1000))
workers=$((2 + RANDOM % 6))
printf '# App settings\nport=%d\n  # Start-up options\n\nworkers=%d\nlabel=job#queue\n' "$port" "$workers" > app.conf
chown player:player app.log app.conf

umask 077
printf '%d\n' "$errors" > /opt/tq/secret/error_count
printf 'port=%d\n\nworkers=%d\nlabel=job#queue\n' "$port" "$workers" > /opt/tq/secret/clean_config
