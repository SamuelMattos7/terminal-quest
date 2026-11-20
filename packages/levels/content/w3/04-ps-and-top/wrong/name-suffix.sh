ps -eo args | sed -n 's/^mystery-daemon-\([0-9][0-9]*\) 600$/\1/p' | while read -r suffix; do tux submit "$suffix"; done
