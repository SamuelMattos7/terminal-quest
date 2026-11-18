#!/usr/bin/env bash
ssh-keygen -q -t ed25519 -N '' -f ~/.ssh/id_ed25519
ssh-copy-id -f -i ~/.ssh/id_ed25519.pub -o IdentityFile=~/.ssh/bootstrap -o StrictHostKeyChecking=accept-new -o BatchMode=yes -o ConnectTimeout=3 deploy@ssh.penguin.corp
remote=$(ssh -n -o IdentitiesOnly=yes -o BatchMode=yes -o ConnectTimeout=3 -i ~/.ssh/id_ed25519 deploy@ssh.penguin.corp hostname)
tux submit "$remote"
cp handoff.txt /tmp/handoff.txt
