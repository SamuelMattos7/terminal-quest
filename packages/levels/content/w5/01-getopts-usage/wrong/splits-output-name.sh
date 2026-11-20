cat > mytool <<'TQ_SCRIPT'
#!/bin/bash
usage() { printf 'Usage: mytool [-v] -o FILE -n N\n'; }
if [[ $# == 1 && $1 == --help ]]; then
  usage
  exit 0
fi
verbose=false out= count=
while getopts ':vo:n:' flag; do
  case "$flag" in
    v) verbose=true ;;
    o) out=$OPTARG ;;
    n) count=$OPTARG ;;
    *) usage >&2; exit 64 ;;
  esac
done
shift "$((OPTIND - 1))"
if [[ $# != 0 || -z $out || ! $count =~ ^([1-9]|1[0-9]|20)$ ]]; then
  usage >&2
  exit 64
fi
seq "$count" > $out || exit 1
if $verbose; then
  printf 'Wrote %s rows\n' "$count" >&2
fi
TQ_SCRIPT
chmod +x mytool
