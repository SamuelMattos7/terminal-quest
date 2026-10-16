ls -lS datadir
big=$(ls -S datadir | head -n 1)
tux submit "$big"
