#!/bin/bash
set -eu
RANDOM=$TQ_SEED
cd /home/player/workbench
chown root:root .
git init -q
git config user.name 'Tux 9000'
git config user.email 'tux@penguin.invalid'
mkdir src
printf '%s\n' healthy >src/status.txt
git add src/status.txt check.sh
git commit -qm 'Initial green status'
printf 'Revision %s\n' "$RANDOM" >README.md
git add README.md
git commit -qm 'Add session notes'
printf '%s\n' degraded >src/status.txt
git add src/status.txt
git commit -qm 'Change status snapshot'
umask 077
git rev-parse HEAD > /opt/tq/secret/bad-commit
umask 022
printf '%s\n' 'Review notes' >>README.md
git commit -qam 'Refresh notes'
chown -R player:player /home/player/workbench
