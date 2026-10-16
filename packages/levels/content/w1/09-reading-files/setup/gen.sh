#!/bin/bash
set -e
mkdir -p /home/player /opt/tq/secret
RANDOM=$TQ_SEED
WORDS=(alpha bravo cobol drift ember flux grove helium indigo joker)
: > /home/player/server.log
i=0
while [ $i -lt 500 ]; do
  w=${WORDS[$((RANDOM % ${#WORDS[@]}))]}
  n=$((RANDOM % 9000 + 1000))
  printf '2026-10-%02d req-%d status=ok zone=%s\n' $(((RANDOM % 28) + 1)) "$n" "$w" >> /home/player/server.log
  i=$((i + 1))
done
head -n 1 /home/player/server.log > /opt/tq/secret/first_line
tail -n 1 /home/player/server.log > /opt/tq/secret/last_line
tail -n 3 /home/player/server.log | head -n 1 > /opt/tq/secret/third_line
chmod 600 /opt/tq/secret/first_line /opt/tq/secret/last_line /opt/tq/secret/third_line
chown player:player /home/player/server.log
