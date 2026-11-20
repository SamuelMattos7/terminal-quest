largest=$(du -s storage/* | sort -nr | head -1 | cut -f2)
tux submit "$(basename "$largest")"
rm -- "$(find storage -name '*.log' -printf '%s %p\n' | sort -n | head -1 | cut -d' ' -f2-)"
