#!/bin/bash
set -eu
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/DEBIAN" "$work/usr/bin"
cat > "$work/DEBIAN/control" <<'META'
Package: penguin-inspect
Version: 1.0
Architecture: all
Maintainer: Terminal Quest <tux@penguin.invalid>
Description: Offline Engine Room status tool
META
cat > "$work/usr/bin/penguin-inspect" <<'SCRIPT'
#!/bin/sh
printf '%s\n' 'Engine room diagnostics ready'
SCRIPT
chmod 755 "$work/usr/bin/penguin-inspect"
dpkg-deb --root-owner-group --build "$work" /home/player/penguin-inspect.deb >/dev/null
install -d -m 700 -o player -g player /home/player/.ssh
runuser -u player -- ssh-keygen -q -t ed25519 -N '' -f /home/player/.ssh/bootstrap
