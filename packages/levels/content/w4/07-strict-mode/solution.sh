cat > sort-report.sh <<'TQ_SCRIPT'
#!/bin/bash
set -euo pipefail
scratch=$(mktemp -d "$TMPDIR/sort.XXXXXX")
trap 'rm -rf -- "$scratch"' EXIT
grep . -- "$1" | sort > "$scratch/sorted"
cat "$scratch/sorted"
TQ_SCRIPT
chmod +x sort-report.sh
