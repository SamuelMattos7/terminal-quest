#!/bin/bash
# Read-only placement audit for w1-12: every manifest entry exists exactly
# once at its listed path, and no other non-hidden files live under home
# (README excepted). Exit 0 iff the sort is perfect.
home=/home/player
manifest=/opt/tq/secret/manifest
if [ ! -f "$manifest" ]; then
  echo "manifest missing"
  exit 1
fi
while IFS= read -r entry; do
  if [ ! -f "$home/$entry" ]; then
    echo "missing: $entry"
    exit 1
  fi
done < "$manifest"
found=$(cd "$home" && find . -type f -not -path './.*' | sed 's|^\./||' | sort)
expected=$( { echo README; cat "$manifest"; } | sort)
if [ "$found" != "$expected" ]; then
  echo "stray or misplaced files:"
  echo "$found"
  exit 1
fi
