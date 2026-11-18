cut -d '|' -f 2 access.log | sort | uniq -c | tr -s ' ' | cut -c 2- | sort -r -k 1,1 | head -n 3 > top3.txt
