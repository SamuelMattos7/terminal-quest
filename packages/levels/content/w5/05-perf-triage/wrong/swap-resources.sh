mapfile -t workers < <(pgrep -f '^tq-load-')
declare -A start
for pid in "${workers[@]}"; do start[$pid]=$(awk '{print $14+$15}' "/proc/$pid/stat"); done
sleep .7
cpu=$(for pid in "${workers[@]}"; do
    ticks=$(awk '{print $14+$15}' "/proc/$pid/stat")
    name=$(ps -o args= -p "$pid" | awk '{print $1}')
    printf '%s %s\n' "$((ticks - start[$pid]))" "$name"
  done | sort -nr | head -1 | cut -d' ' -f2)
mem=$(ps -eo rss,args --sort=-rss | awk '$2 ~ /^tq-load-/ {print $2; exit}')
io=$(for pid in $(pgrep -f '^tq-load-'); do
    chars=$(awk '/^wchar:/ {print $2}' "/proc/$pid/io")
    name=$(ps -o args= -p "$pid" | awk '{print $1}')
    printf '%s %s\n' "$chars" "$name"
  done | sort -nr | head -1 | cut -d' ' -f2)
tux submit "CPU=$mem"
tux submit "MEM=$cpu"
tux submit "IO=$io"
pkill -TERM -f '^tq-load-'
