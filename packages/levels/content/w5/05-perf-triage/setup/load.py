#!/usr/bin/python3
import os
import time
from pathlib import Path

ready = Path("/tmp/tq-load-ready") / str(os.getpid())
kind = os.environ["TQ_LOAD"]
if kind == "memory":
    buffer = bytearray(24 * 1024 * 1024)
    for index in range(0, len(buffer), 4096):
        buffer[index] = 1
    ready.touch()
    time.sleep(600)
elif kind == "io":
    block = b"q" * (128 * 1024)
    with open("/tmp/tq-load.scratch", "wb", buffering=0) as scratch:
        scratch.write(block)
        ready.touch()
        while True:
            scratch.seek(0)
            scratch.write(block)
            os.fsync(scratch.fileno())
            time.sleep(0.04)
else:
    ready.touch()
    while True:
        for _ in range(500000):
            pass
        time.sleep(0.005)
