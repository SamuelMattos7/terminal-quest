tux submit "$(cut -d ' ' -f 1 access.log | sort | uniq | wc -l)"
