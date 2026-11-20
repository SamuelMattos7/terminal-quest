#!/bin/bash
set -eu
install -d -m 700 -o player -g player /home/player/.ssh
runuser -u player -- ssh-keygen -q -t ed25519 -N '' -f /home/player/.ssh/bootstrap
