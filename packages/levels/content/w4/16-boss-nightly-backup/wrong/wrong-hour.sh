cat > backup.sh <<'TQ_SCRIPT'
#!/bin/bash
set -euo pipefail
if [[ $# != 2 ]]; then
  printf 'Usage: backup.sh SOURCE DEST\n' >&2
  exit 64
fi
src=$1
dest=$2
[[ -d $src ]] || { printf 'Source directory is missing\n' >&2; exit 66; }
mkdir -p -- "$dest"
exec 9>"$dest/.backup.lock"
flock -n 9 || exit 75
stamp=$(date -u +%Y%m%dT%H%M%SZ)
archive="snapshot-$stamp.tar.gz"
tmp=$(mktemp "$dest/.snapshot.XXXXXX")
trap 'rm -f -- "$tmp"' EXIT
tar -czf "$tmp" -C "$src" .
mv -f -- "$tmp" "$dest/$archive"
mapfile -t snapshots < <(find "$dest" -maxdepth 1 -type f -name 'snapshot-*.tar.gz' -printf '%f\n' | LC_ALL=C sort -r)
for old in "${snapshots[@]:7}"; do
  rm -- "$dest/$old"
done
printf 'Created %s\n' "$archive" >> "$dest/backup.log"
TQ_SCRIPT
chmod +x backup.sh
./backup.sh ~/demo-src ~/demo-dest
crontab - <<'CRON'
2 0 * * * /home/player/backup.sh /home/player/demo-src /home/player/demo-dest
CRON
