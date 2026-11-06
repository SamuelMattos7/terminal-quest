cut -d '|' -f 2 access.log | uniq -c | sort -nr -k 1,1 | head -n 3 | tr -s ' ' | cut -c 2- > top3.txt
