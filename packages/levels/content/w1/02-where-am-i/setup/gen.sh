#!/bin/bash
# Seeded setup for w1-02 (plan.md §8.4): deterministic per TQ_SEED, answers
# go to /opt/tq/secret (mode 600), never into plaintext setup files.
set -e
WORDS=(banana walrus copper lantern otter pebble marlin quartz saffron tundra)
RANDOM=$TQ_SEED
w=${WORDS[$((RANDOM % ${#WORDS[@]}))]}
mkdir -p /opt/tq/secret
printf '%s' "$w" > /opt/tq/secret/welcome_word
chmod 600 /opt/tq/secret/welcome_word
printf 'Welcome to Penguin Corp!\n' > "/home/player/welcome-$w.txt"
for f in memo-1.txt notes.txt todo.txt; do echo "$f" > "/home/player/$f"; done
chown player:player /home/player/*
