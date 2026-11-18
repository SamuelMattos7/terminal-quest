#!/usr/bin/env bash
set -euo pipefail

install -d -o player -g player -m 0700 /home/player/.ssh
runuser -u player -- ssh-keygen -q -t ed25519 -N '' -C bootstrap -f /home/player/.ssh/bootstrap
umask 077
printf 'ssh-%s\n' "$TQ_SEED" > /opt/tq/secret/ssh_hostname
printf 'Intranet handoff %s\n' "$TQ_SEED" > /home/player/handoff.txt
chown player:player /home/player/handoff.txt
