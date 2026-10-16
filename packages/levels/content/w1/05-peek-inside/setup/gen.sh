#!/bin/bash
set -e
WORDS=(acorn badger cinder ember flint grove harbor ivy juniper kelp)
RANDOM=$TQ_SEED
w=${WORDS[$((RANDOM % ${#WORDS[@]}))]}
mkdir -p /home/player/attic /opt/tq/secret
printf 'dust and old cables\n' > /home/player/attic/notes.txt
printf 'definitely nothing hidden here\n' > /home/player/attic/todo.txt
printf '%s\n' "$w" > /home/player/attic/.secret
printf '%s' "$w" > /opt/tq/secret/passphrase
chmod 600 /opt/tq/secret/passphrase
chown -R player:player /home/player/attic
