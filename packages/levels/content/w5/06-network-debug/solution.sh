ss -tln
sudo iptables -S INPUT
sudo iptables -D INPUT -p tcp --dport 8080 -j REJECT
timeout 5s sudo tcpdump -l -nn -i lo -c 1 tcp port 8080 >packet.txt 2>capture.log &
capture_pid=$!
for attempt in {1..30}; do grep -q 'listening on' capture.log && break; sleep .04; done
curl -fsS --max-time 2 http://127.0.0.1:8080/health.txt
wait "$capture_pid"
