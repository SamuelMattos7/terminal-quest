cat > reconcile.sh <<'TQ_SCRIPT'
#!/bin/bash
set -euo pipefail
[[ $# == 2 ]] || exit 64
dest=$1 token=$2
mkdir -p -- "$dest"
exec 9>"$dest/.reconcile.lock"
flock -n 9 || exit 75
next=$(mktemp "$dest/.tags.XXXXXX")
trap 'rm -f -- "$next"' EXIT
{
  if [[ -f $dest/tags.txt ]]; then cat -- "$dest/tags.txt"; fi
  printf '%s\n' "$token"
} | LC_ALL=C sort -u > "$next"
mv -f -- "$next" "$dest/tags.txt"
TQ_SCRIPT
chmod +x reconcile.sh
./reconcile.sh registry north
./reconcile.sh registry north
./reconcile.sh registry south
