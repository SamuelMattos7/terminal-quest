#!/bin/bash
set -eu
RANDOM=$TQ_SEED

root=/etc/penguin
manifest=/opt/tq/secret/conf_paths
dirs=("$root" "$root/services" "$root/archive/legacy.conf")
names=(audit billing intake mail relay storage)
extensions=(conf CONF Conf)
mkdir -p "${dirs[@]}" /opt/tq/secret
umask 077
: > "$manifest"
umask 022

count=$((3 + RANDOM % 3))
for ((i = 0; i < count; i++)); do
  dir=${dirs[i % ${#dirs[@]}]}
  name=${names[RANDOM % ${#names[@]}]}
  extension=${extensions[i % ${#extensions[@]}]}
  path="$dir/$name-$i.$extension"
  printf 'enabled=true\n' > "$path"
  printf '%s\n' "$path" >> "$manifest"
done

printf 'Archived copy.\n' > "$root/services/old.conf.bak"
printf 'Service notes.\n' > "$root/README.txt"
