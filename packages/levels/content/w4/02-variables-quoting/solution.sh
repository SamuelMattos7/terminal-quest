cat > badge.sh <<'TQ_SCRIPT'
#!/bin/bash
zone=$(printf '%s' "$2" | tr '[:lower:]' '[:upper:]')
printf 'Guest: %s | Station: %s\n' "$1" "$zone"
TQ_SCRIPT
chmod +x badge.sh
