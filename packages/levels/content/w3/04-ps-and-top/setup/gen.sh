#!/bin/bash
set -eu
RANDOM=$TQ_SEED
tag=$RANDOM
pid=$(runuser -u player -- bash -c 'exec -a "$1" sleep 600 </dev/null >/dev/null 2>&1 & echo $!' bash "mystery-daemon-$tag")
umask 077
printf '%s\n' "$pid" > /opt/tq/secret/mystery-pid
