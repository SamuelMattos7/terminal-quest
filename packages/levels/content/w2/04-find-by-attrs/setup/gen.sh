#!/bin/bash
set -eu

cd /home/player
mkdir -p cache/images cache/pending
touch cache/session.tmp cache/images/render.tmp
printf 'cached data\n' | tee cache/catalog.bin cache/images/thumbnail.bin cache/index.bin cache/images/preview.bin >/dev/null
touch -d '10 days ago' cache/catalog.bin
touch -d '12 days ago' cache/images/thumbnail.bin
touch -d '169 hours ago' cache/images/preview.bin
chown -R player:player cache
