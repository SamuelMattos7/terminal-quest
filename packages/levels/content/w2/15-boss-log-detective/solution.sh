ip=$(grep '^alert ssh-bruteforce ' gateway.log | cut -d ' ' -f 3)
rows=$(grep -F " FAIL $ip " auth.log | sort)
first=$(printf '%s\n' "$rows" | head -n 1)
time=$(printf '%s\n' "$first" | cut -d ' ' -f 1)
user=$(printf '%s\n' "$first" | cut -d ' ' -f 4)
count=$(printf '%s\n' "$rows" | wc -l)
tux submit "$ip"
tux submit "$time"
tux submit "$user"
tux submit "$count"
printf 'Attacker IP: %s\nFirst failure: %s\nTarget user: %s\nFailed attempts: %s\n' "$ip" "$time" "$user" "$count" > report.txt
