cat > normalize.sh <<'TQ_SCRIPT'
#!/bin/bash
set -euo pipefail
[[ $# == 1 ]] || exit 64
sed '/^[[:space:]]*$/d' -- "$1" | LC_ALL=C sort -u
TQ_SCRIPT
chmod +x normalize.sh
cat > normalize.bats <<'TQ_SCRIPT'
#!/usr/bin/env bats
@test "ordinary file works" {
  echo alpha >ordinary
  run bash "$NORMALIZE" ordinary
  [ "$status" -eq 0 ]
}
TQ_SCRIPT
chmod +x normalize.bats
