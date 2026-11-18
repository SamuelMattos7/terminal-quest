id
code=$(cat /root/access-code.txt 2>/dev/null) || code=unreadable
tux submit "$code"
