cat > receipt.sh <<'TQ_SCRIPT'
#!/bin/bash
subtotal=$2
printf '%s: %d credits\n' "$1" "$((subtotal + subtotal / 5))"
TQ_SCRIPT
chmod +x receipt.sh
