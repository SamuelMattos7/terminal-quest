#!/bin/sh
set -eu

# RFC 5737 documentation address, used as a lookup exercise only.
db_ip="192.0.2.$((TQ_SEED % 254 + 1))"
exec dnsmasq --keep-in-foreground --conf-file=/dev/null --no-resolv --no-hosts \
  --log-facility=- --user=nobody --group=nogroup \
  --local=/penguin.corp/ --host-record="db.penguin.corp,$db_ip"
