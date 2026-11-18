tux submit "$(grep -c '^ERROR[[:space:]]' app.log)"
grep -v '^[[:space:]]*#' app.conf > clean.conf
