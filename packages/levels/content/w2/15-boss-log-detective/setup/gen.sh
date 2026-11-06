#!/bin/bash
set -eu

RANDOM=$TQ_SEED
ip="192.0.2.$((10 + RANDOM % 10))"
neighbor="${ip}0"
hour=$((8 + RANDOM % 10))
minute=$((RANDOM % 45))
second=$((RANDOM % 60))
first=$(printf '%02d:%02d:%02d' "$hour" "$minute" "$second")
users=(clerk dispatch operator auditor archivist)
user=${users[RANDOM % ${#users[@]}]}
count=$((3 + RANDOM % 5))

cd /home/player
printf 'info ssh-probe %s\nalert ssh-bruteforce %s\ninfo healthcheck 198.51.100.9\n' "$neighbor" "$ip" > gateway.log
{
  for ((i = count - 1; i > 0; i--)); do
    printf '%02d:%02d:%02d FAIL %s %s\n' "$hour" "$((minute + i))" "$second" "$ip" "$user"
  done
  printf '02:00:00 FAIL %s guest\n' "$neighbor"
  printf '03:00:00 OK %s %s\n' "$ip" "$user"
  printf '%s FAIL %s %s\n' "$first" "$ip" "$user"
  printf '04:00:00 FAIL 198.51.100.9 monitor\n'
} > auth.log
chown player:player auth.log gateway.log

umask 077
printf '%s\n' "$ip" > /opt/tq/secret/ip
printf '%s\n' "$first" > /opt/tq/secret/time
printf '%s\n' "$user" > /opt/tq/secret/user
printf '%s\n' "$count" > /opt/tq/secret/count
