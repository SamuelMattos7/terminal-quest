leak=$(grep -rEl '^AKIA' ~/config | sort | head -n 1)
tux submit "${leak##*/}"
