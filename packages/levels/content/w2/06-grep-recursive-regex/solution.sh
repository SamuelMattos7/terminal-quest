grep -rEn '^AKIA[A-Z0-9]{16}$' ~/config
leak=$(grep -rEl '^AKIA[A-Z0-9]{16}$' ~/config)
tux submit "${leak##*/}"
