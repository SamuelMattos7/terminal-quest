#!/bin/sh
set -eu
mkdir -p /run/sshd
ssh-keygen -q -t ed25519 -N '' -f /etc/ssh/ssh_host_ed25519_key
exec /usr/sbin/sshd -D -e
