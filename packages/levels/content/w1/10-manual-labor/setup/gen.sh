#!/bin/bash
set -e
mkdir -p /home/player/datadir /opt/tq/secret
RANDOM=$TQ_SEED
WORDS=(amber birch coral dune elm frost grove heath iris jade)
idx=(0 1 2 3 4 5 6 7 8 9)
i=$((${#idx[@]} - 1))
while [ $i -gt 0 ]; do
  j=$((RANDOM % (i + 1)))
  tmp=${idx[i]}
  idx[i]=${idx[j]}
  idx[j]=$tmp
  i=$((i - 1))
done
k=0
while [ $k -lt 6 ]; do
  name=${WORDS[${idx[k]}]}
  size=$(((k + 1) * 137))
  head -c "$size" /dev/zero | tr '\0' 'f' > "/home/player/datadir/$name.txt"
  k=$((k + 1))
done
printf '%s' "${WORDS[${idx[5]}]}.txt" > /opt/tq/secret/largest
chmod 600 /opt/tq/secret/largest
chown -R player:player /home/player/datadir
