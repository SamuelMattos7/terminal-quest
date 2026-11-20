./job.py shift &
job=$!
for attempt in {1..15}; do [ -f shift.ready ] && break; sleep .02; done
kill -STOP "$job"
sleep .05
ps -o stat= -p "$job" > stopped.txt
nohup ./job.py watch >watch.log 2>&1 &
