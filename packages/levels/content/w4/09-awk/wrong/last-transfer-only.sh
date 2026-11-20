awk '{bytes[$1]=$2} END{for (user in bytes) print user, bytes[user]}' transfers.log | LC_ALL=C sort >totals.txt
