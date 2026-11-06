#!/bin/bash
set -eu

report=/home/player/report.txt
[[ -f $report ]] || exit 1
mapfile -t lines < "$report"
secret=/opt/tq/secret
[[ ${#lines[@]} -eq 4 &&
  ${lines[0]} == "Attacker IP: $(<"$secret/ip")" &&
  ${lines[1]} == "First failure: $(<"$secret/time")" &&
  ${lines[2]} == "Target user: $(<"$secret/user")" &&
  ${lines[3]} == "Failed attempts: $(<"$secret/count")" ]]
