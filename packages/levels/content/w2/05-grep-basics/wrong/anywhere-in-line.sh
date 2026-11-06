tux submit "$(grep -ic 'ERROR' app.log)"
grep -v '^[[:space:]]*#' app.conf > clean.conf
