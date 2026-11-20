reader=$(pgrep -f '^tq-ingest ')
feed=$(lsof -w -a -p "$reader" -Fn | sed -n 's@^n/tmp/tq-debug/@@p' | head -1)
tux submit "$feed"
writer=$(pgrep -f '^tq-log-holder ')
leaf=$(lsof -w -a -p "$writer" +L1 -Fn | sed -n 's@^n/tmp/tq-debug/\(.*\) (deleted)$@\1@p' | head -1)
tux submit "$leaf"
kill -TERM "$reader"
