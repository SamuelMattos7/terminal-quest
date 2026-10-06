#!/bin/sh
# modeof — print the octal permission bits of a path (checker helper).
# Usage: modeof.sh <path>
set -u
if [ "$#" -ne 1 ]; then
  echo "Usage: modeof.sh <path>" >&2
  exit 2
fi
stat -c %a "$1"
