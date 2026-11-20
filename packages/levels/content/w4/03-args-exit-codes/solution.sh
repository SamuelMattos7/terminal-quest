cat > dispatch.sh <<'TQ_SCRIPT'
#!/bin/bash
if (( $# != 2 )); then
  printf 'Usage: dispatch SOURCE DEST\n' >&2
  exit 64
fi
printf '%s -> %s\n' "$1" "$2"
TQ_SCRIPT
chmod +x dispatch.sh
