largest=$(du -s storage/* | sort -nr | head -1 | cut -f2)
tux submit "$(basename "$largest")"
largest_log=$(find storage -name '*.log' -printf '%s %p\n' | sort -nr | head -1 | cut -d' ' -f2-)
rm -- "$largest_log"
