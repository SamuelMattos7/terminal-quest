cat >engine.rotate <<'ROTATE'
/home/player/logs/engine.log {
    weekly
    rotate 4
    compress
    missingok
}
ROTATE
/usr/sbin/logrotate -d -s /dev/null engine.rotate
