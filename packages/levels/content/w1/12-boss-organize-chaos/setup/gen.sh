#!/bin/bash
set -e
mkdir -p /home/player/tmp/cache /opt/tq/secret
RANDOM=$TQ_SEED
WORDS=(aspen birch cedar dogwood elm fig grove hazel ivy juniper kale larch)
: > /opt/tq/secret/manifest
plan="jpg jpg jpg jpg jpg jpg jpg jpg txt txt txt txt txt txt txt txt txt txt pdf pdf pdf pdf pdf pdf log log log log log log"
n=0
for ext in $plan; do
  n=$((n + 1))
  w=${WORDS[$((RANDOM % ${#WORDS[@]}))]}
  name="$w-$n.$ext"
  printf 'seeded clutter file %d\n' "$n" > "/home/player/$name"
  case "$ext" in
    jpg) dir=Pictures ;;
    txt | pdf) dir=Documents ;;
    log) dir=Logs ;;
  esac
  printf '%s/%s\n' "$dir" "$name" >> /opt/tq/secret/manifest
done
printf 'old junk, delete me\n' > /home/player/tmp/junk1.txt
printf 'older junk, delete me\n' > /home/player/tmp/cache/old.log
chmod 600 /opt/tq/secret/manifest
chown -R player:player /home/player
