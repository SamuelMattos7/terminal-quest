#!/usr/bin/env bash
remote=$(ssh -n -o StrictHostKeyChecking=accept-new -o BatchMode=yes -o ConnectTimeout=3 -i ~/.ssh/bootstrap deploy@ssh.penguin.corp hostname)
tux submit "$remote"
scp -o BatchMode=yes -o ConnectTimeout=3 -i ~/.ssh/bootstrap handoff.txt deploy@ssh.penguin.corp:~/
