ls -lS datadir
small=$(ls -Sr datadir | head -n 1)
tux submit "$small"
