#!/bin/bash
set -eu
RANDOM=$TQ_SEED
cd /home/player
folders=(site cache reports)
winner=$((RANDOM % 3))
for i in 0 1 2; do
  dir="storage/${folders[i]}"
  mkdir -p "$dir"
  dd if=/dev/zero of="$dir/engine-$i.log" bs=4096 count=$((i+2)) status=none
done
name=${folders[winner]}
path="/home/player/storage/$name/engine-$((RANDOM % 500 + 500)).log"
dd if=/dev/zero of="$path" bs=4096 count=64 status=none
chown -R player:player storage
umask 077
printf '%s\n' "$name" > /opt/tq/secret/largest-dir
printf '%s\n' "$path" > /opt/tq/secret/largest-log
