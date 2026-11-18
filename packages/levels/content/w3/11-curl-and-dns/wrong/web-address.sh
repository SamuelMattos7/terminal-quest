#!/usr/bin/env bash
curl -fsS -o status.json http://web.penguin.corp/status
tux submit "$(dig +short web.penguin.corp A)"
