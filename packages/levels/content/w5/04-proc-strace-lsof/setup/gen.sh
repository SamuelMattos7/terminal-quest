#!/bin/bash
set -eu
RANDOM=$TQ_SEED
dir=/tmp/tq-debug
install -d -o player -g player "$dir"
feed="feed-$((RANDOM % 700 + 100)).fifo"
leaf="journal-$((RANDOM % 700 + 100)).log"
mkfifo "$dir/$feed"
dd if=/dev/zero of="$dir/$leaf" bs=1048576 count=6 status=none
chown player:player "$dir/$feed" "$dir/$leaf"
runuser -u player -- env TQ_FILE="$dir/$feed" TQ_PROBE=blocked bash -c 'exec -a tq-ingest /usr/bin/python3 /opt/tq/inspect-fd.py' </dev/null >/dev/null 2>&1 &
runuser -u player -- env TQ_FILE="$dir/$leaf" TQ_PROBE=deleted bash -c 'exec -a tq-log-holder /usr/bin/python3 /opt/tq/inspect-fd.py' </dev/null >/dev/null 2>&1 &
for attempt in {1..60}; do
  if [[ -e $dir/reader.ready && -e $dir/writer.ready ]]; then break; fi
  sleep .03
done
test -e "$dir/reader.ready" && test -e "$dir/writer.ready"
umask 077
printf '%s\n' "$feed" > /opt/tq/secret/feed
printf '%s\n' "$leaf" > /opt/tq/secret/held-log
df -B1 --output=used /tmp | tail -1 > /opt/tq/secret/tmp-used
