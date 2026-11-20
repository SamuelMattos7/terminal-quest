crontab - <<'CRON'
*/5 * * * * /home/player/bin/heartbeat
0 3 * * 1-5 /home/player/bin/sweep
30 2 1 * * /home/player/bin/inventory
CRON
tux cron '30 2 1 * *'
tux submit 02:30 on the first day of every month
