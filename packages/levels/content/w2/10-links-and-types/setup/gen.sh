#!/bin/bash
set -eu
RANDOM=$TQ_SEED

cd /home/player
case $((TQ_SEED % 3)) in
  0)
    printf 'Dispatch %d\n' "$RANDOM" > mystery.bin
    mime_type=text/plain
    ;;
  1)
    printf 'Dispatch %d\n' "$RANDOM" | gzip -n > mystery.bin
    mime_type=application/gzip
    ;;
  2)
    printf '%s' 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7' | base64 -d > mystery.bin
    mime_type=image/gif
    ;;
esac
chmod 644 mystery.bin

mkdir -p /opt/tq/secret
umask 077
printf '%s\n' "$mime_type" > /opt/tq/secret/mime_type
