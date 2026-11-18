#!/usr/bin/env bash
curl -fsSI -o status.json http://web.penguin.corp/status
tux submit "$(dig +short db.penguin.corp A)"
