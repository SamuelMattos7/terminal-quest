crontab - <<'CRON'
MAILTO=""
15 6 * * * ./bin/collect >> /home/player/audit.log 2>&1
CRON
