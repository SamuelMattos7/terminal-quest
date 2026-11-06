#!/bin/bash
set -eu

test ! -L /home/player/archive
cd /home/player/archive
test -d reports/2025
test -f README
test -f reports/.index
test -f reports/2025/summary.txt

# Report one unexpected entry, including a symlink or a mode mismatch.
unexpected=$(find . ! \( -type d -perm 0755 -o -type f -perm 0644 \) -print -quit)
test -z "$unexpected"
