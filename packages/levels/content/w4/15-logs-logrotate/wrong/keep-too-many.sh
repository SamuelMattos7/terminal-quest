cat >engine.rotate <<'ROTATE'
/home/player/logs/engine.log {
    weekly
    rotate 5
    compress
    missingok
}
ROTATE
