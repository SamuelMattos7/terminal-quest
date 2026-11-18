#!/bin/bash
set -eu
RANDOM=$TQ_SEED

cd /home/player
mkdir -p config/{billing,ops/archive,relay} /opt/tq/secret
dirs=(config/billing config/ops config/ops/archive config/relay)
slot=$((RANDOM % 38))
for ((i = 0; i < 38; i++)); do
  dir=${dirs[i % ${#dirs[@]}]}
  printf -v filename 'service-%02d.env' "$i"
  printf 'DEBUG=false\nSERVICE_ID=%d\n' "$i" > "$dir/$filename"
  if ((i == slot)); then
    printf 'AKIA%04X%04X%04X%04X\n' "$RANDOM" "$RANDOM" "$RANDOM" "$RANDOM" >> "$dir/$filename"
    (umask 077; printf '%s\n' "$filename" > /opt/tq/secret/leak_file)
  fi
done

printf '# Example: AKIA0000000000000000 (documentation only)\n' > config/00-example.env
printf 'AKIA0000\n' > config/01-prefix.env
chown -R player:player config
