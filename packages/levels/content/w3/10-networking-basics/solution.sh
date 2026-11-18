#!/usr/bin/env bash
ip a
ping -c 1 -W 1 web.penguin.corp
port=$(ss -H -tlnp | awk '/python3/ && $4 ~ /^127[.]0[.]0[.]1:/ {sub(/^.*:/, "", $4); print $4}')
tux submit "$port"
