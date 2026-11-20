cat > receipt.sh <<'TQ_SCRIPT'
#!/bin/bash
add_tax() {
  local subtotal=$1
  printf '%d\n' "$((subtotal + subtotal / 5))"
}
print_total() {
  local label=$1
  printf '%s: %s credits\n' "$label" "$(add_tax "$2")"
}
print_total "$1" "$2"
TQ_SCRIPT
chmod +x receipt.sh
