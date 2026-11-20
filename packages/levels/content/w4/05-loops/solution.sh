cat > rename.sh <<'TQ_SCRIPT'
#!/bin/bash
shopt -s nullglob
for item in "$1"/*.txt; do
  mv -- "$item" "$item.bak"
done
TQ_SCRIPT
chmod +x rename.sh
cat > sum.sh <<'TQ_SCRIPT'
#!/bin/bash
total=0
while IFS= read -r n || [[ -n $n ]]; do
  total=$((total + n))
done
printf '%d\n' "$total"
TQ_SCRIPT
chmod +x sum.sh
