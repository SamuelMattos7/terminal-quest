sudo iptables -D INPUT -p tcp --dport 8080 -j REJECT
curl -fsS http://127.0.0.1:8080/health.txt >packet.txt
