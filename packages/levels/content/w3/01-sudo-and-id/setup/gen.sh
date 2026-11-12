#!/bin/bash
set -eu
RANDOM=$TQ_SEED
umask 077
mkdir -p /opt/tq/secret
code="engine-$RANDOM-$RANDOM"
printf '%s\n' "$code" > /root/access-code.txt
printf '%s\n' "$code" > /opt/tq/secret/access_code
chmod 600 /root/access-code.txt /opt/tq/secret/access_code
