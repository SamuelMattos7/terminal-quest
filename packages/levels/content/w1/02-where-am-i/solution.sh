pwd
ls
f=$(ls welcome-*.txt); w=${f#welcome-}; w=${w%.txt}
tux submit "$w"
