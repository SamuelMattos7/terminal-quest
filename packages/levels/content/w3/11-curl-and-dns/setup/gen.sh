#!/usr/bin/env bash
set -euo pipefail

umask 077
ip=$(dig +short +time=1 +tries=2 db.penguin.corp A)
[[ $ip =~ ^192[.]0[.]2[.][0-9]+$ ]]
printf '%s\n' "$ip" > /opt/tq/secret/db_ip
curl --noproxy '*' -fsS --max-time 3 http://web.penguin.corp/status > /opt/tq/secret/status
