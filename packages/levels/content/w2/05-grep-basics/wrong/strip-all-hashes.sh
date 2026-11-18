tux submit "$(grep -ic '^ERROR[[:space:]]' app.log)"
grep -v '#' app.conf > clean.conf
