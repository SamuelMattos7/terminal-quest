cat > classify.sh <<'TQ_SCRIPT'
#!/bin/bash
if [[ -f $1 ]]; then
  printf 'file\n'
elif [[ -d $1 ]]; then
  printf 'directory\n'
else
  printf 'missing\n'
fi
TQ_SCRIPT
chmod +x classify.sh
