#!/usr/bin/env bash
set -euo pipefail

RANDOM=$TQ_SEED
port=$((20000 + RANDOM % 20000))
umask 077
printf '%s\n' "$port" > /opt/tq/secret/intranet_port
install -d -m 0755 /srv/intranet
printf 'Intranet relay online\n' > /srv/intranet/index.html
chmod 0644 /srv/intranet/index.html
runuser -u player -- python3 -m http.server "$port" --bind 127.0.0.1 --directory /srv/intranet \
  < /dev/null > /dev/null 2>&1 &
relay=$!
for _ in {1..40}; do
  if curl --noproxy '*' -fsS --max-time 1 "http://127.0.0.1:$port/" > /dev/null 2>&1; then
    exit 0
  fi
  kill -0 "$relay"
  sleep 0.05
done
echo 'Intranet relay failed to start' >&2
exit 1
