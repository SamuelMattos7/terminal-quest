#!/usr/bin/env bash
curl -fsSI http://web.penguin.corp/status
curl -fsS -o status.json http://web.penguin.corp/status
tux submit "$(dig +short db.penguin.corp A)"
