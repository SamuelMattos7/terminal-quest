pkill -TERM -f '^tq-old-log '
pkill -KILL -f '^tq-runaway '
crontab - <<'CRON'
*/5 * * * * /home/player/bin/health-check
CRON
sed -i 's/^mode=.*/mode=active/; s/^port=.*/port=8080/' service.conf
tq-appctl configtest
source_ip=$(awk '$2 == "FAILED" {print $3}' events.log | sort | uniq -c | sort -nr | awk 'NR == 1 {print $2}')
sudo iptables -I INPUT -s "$source_ip" -j DROP
cat > postmortem.sh <<'TQ_SCRIPT'
#!/bin/bash
set -euo pipefail
[[ $# == 1 ]] || exit 64
count=$(awk '$2 == "FAILED" {n++} END {print n+0}' "$1")
source_ip=$(awk '$2 == "FAILED" {print $3}' "$1" |
  LC_ALL=C sort | uniq -c | LC_ALL=C sort -k1,1nr -k2,2 |
  awk 'NR == 1 {print $2}')
printf 'FAILED=%s\nTOP=%s\n' "$count" "${source_ip:-none}"
TQ_SCRIPT
chmod +x postmortem.sh
