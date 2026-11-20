jq -r '.users[] | select(.active) | .email' users.json >active.txt
find './drop' -type f -name '*.tmp' -print | xargs -r rm --
