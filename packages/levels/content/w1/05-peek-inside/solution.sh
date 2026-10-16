ls -la attic
w=$(cat attic/.secret)
tux submit "$w"
