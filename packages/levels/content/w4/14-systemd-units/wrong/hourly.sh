cat > /etc/systemd/system/report.service <<'UNIT'
[Service]
Type=simple
User=player
ExecStart=/usr/local/bin/report.sh
UNIT
cat > /etc/systemd/system/report.timer <<'UNIT'
[Timer]
OnCalendar=hourly

[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload
systemctl start report.service
systemctl start report.timer
systemctl enable report.timer
journalctl -u report.service
