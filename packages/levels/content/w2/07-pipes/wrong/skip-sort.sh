tux submit "$(cut -d ' ' -f 1 access.log | uniq | wc -l)"
