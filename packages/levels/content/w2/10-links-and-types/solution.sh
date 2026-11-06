ln -s release-v2 latest
stat latest
tux submit "$(file -b --mime-type mystery.bin)"
