#!/bin/bash
set -eu
RANDOM=$TQ_SEED
mkdir -p /tmp/incident
chown player:player /tmp/incident
dd if=/dev/zero of=/tmp/incident/engine.log bs=1048576 count=6 status=none
chown player:player /tmp/incident/engine.log
runuser -u player -- bash -c 'exec 3</tmp/incident/engine.log; rm /tmp/incident/engine.log; touch /tmp/incident/ready; exec -a tq-old-log sleep 600' </dev/null >/dev/null 2>&1 &
runuser -u player -- bash -c 'exec -a tq-runaway bash -c "while :; do :; done"' </dev/null >/dev/null 2>&1 &
for attempt in {1..60}; do
  [[ -f /tmp/incident/ready ]] && break
  sleep .03
done
test -f /tmp/incident/ready
source_ip="198.51.100.$((RANDOM%100+100))"
{
  printf '%s\n' '00:01 OK 198.51.100.9' '00:08 FAILED 198.51.100.12'
  for minute in 11 13 20 21 24; do printf '00:%s FAILED %s\n' "$minute" "$source_ip"; done
  printf '%s\n' '00:26 OK 198.51.100.31'
} > /home/player/events.log
chown player:player /home/player/events.log
printf '%s\n' '5 * * * * ./health-check' | crontab -u player -
umask 077
printf '%s\n' "$source_ip" > /opt/tq/secret/incident-source
df -B1 --output=used /tmp | tail -1 > /opt/tq/secret/incident-disk
