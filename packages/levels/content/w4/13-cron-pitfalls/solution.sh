crontab - <<'CRON'
MAILTO=""
15 6 * * * /home/player/ops/bin/collect >> /home/player/audit.log 2>&1
CRON
