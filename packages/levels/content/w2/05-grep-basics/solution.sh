grep -in '^ERROR[[:space:]]' app.log
tux submit "$(grep -ic '^ERROR[[:space:]]' app.log)"
grep -v '^[[:space:]]*#' app.conf > clean.conf
