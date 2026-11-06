leak=$(grep -rEl 'AKIA[A-Z0-9]{16}' ~/config | sort | head -n 1)
tux submit "${leak##*/}"
