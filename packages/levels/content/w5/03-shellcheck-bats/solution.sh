cat > normalize.sh <<'TQ_SCRIPT'
#!/bin/bash
set -euo pipefail
[[ $# == 1 ]] || exit 64
sed '/^[[:space:]]*$/d' -- "$1" | LC_ALL=C sort -u
TQ_SCRIPT
chmod +x normalize.sh
cat > normalize.bats <<'TQ_SCRIPT'
#!/usr/bin/env bats
setup() {
  candidate=${NORMALIZE:-$HOME/normalize.sh}
}
@test "handles spaces and sorts unique nonblank rows" {
  input="$BATS_TEST_TMPDIR/ice ledger"
  printf 'zulu\n\nalpha\nzulu\n \n' >"$input"
  run bash "$candidate" "$input"
  [ "$status" -eq 0 ]
  [ "$output" = $'alpha\nzulu' ]
}
@test "missing input is usage error" {
  run bash "$candidate"
  [ "$status" -eq 64 ]
}
TQ_SCRIPT
chmod +x normalize.bats
