a=$(head -n 1 server.log)
tux submit "$a"
b=$(tail -n 1 server.log)
tux submit "$b"
c=$(tail -n 3 server.log | sed -n 2p)
tux submit "$c"
