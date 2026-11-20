#!/bin/bash
set -eu
RANDOM=$TQ_SEED
cd /home/player
a=$((RANDOM%100+1))
b=$((RANDOM%100+1))
c=$((RANDOM%100+1))
d=$((RANDOM%100+1))
e=$((RANDOM%100+1))
f=$((RANDOM%100+1))
printf 'tux %d\nmira %d\ntux %d\nada %d\nmira %d\nada %d\n' "$a" "$b" "$c" "$d" "$e" "$f" > transfers.log
chown player:player transfers.log
umask 077
printf 'ada %d\nmira %d\ntux %d' "$((d+f))" "$((b+e))" "$((a+c))" > /opt/tq/secret/transfer-totals
