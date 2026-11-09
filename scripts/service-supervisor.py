#!/usr/bin/env python3
"""Rotate control-service output continuously and preserve signal ownership."""
import logging
from logging.handlers import RotatingFileHandler
import os
from pathlib import Path
import signal
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]

def rotating_handler(path, max_bytes=1048576, backups=3):
    if max_bytes < 1024 or backups < 1:
        raise ValueError("invalid rotation limits")
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    handler = RotatingFileHandler(path, maxBytes=max_bytes, backupCount=backups, encoding="utf-8")
    handler.setFormatter(logging.Formatter("%(asctime)s %(message)s"))
    return handler

def main():
    env = dict(os.environ, TESTER_SERVICE_PID=str(os.getpid()), PYTHONUNBUFFERED="1")
    logger = logging.getLogger("tester-control")
    logger.setLevel(logging.INFO)
    handler = rotating_handler(env.get("TESTER_CONTROL_LOG", "/opt/logs/tester-control.log"),
                               int(env.get("TESTER_LOG_MAX_BYTES", "1048576")),
                               int(env.get("TESTER_LOG_BACKUPS", "3")))
    logger.addHandler(handler)
    child = subprocess.Popen([sys.executable, str(ROOT / "scripts/tester-control.py")],
                             cwd=ROOT, env=env, stdin=subprocess.DEVNULL,
                             stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    def stop(signum, frame):
        if child.poll() is None:
            child.terminate()
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    try:
        # Bounded reads also cap an accidentally huge log line.
        while chunk := child.stdout.readline(4096):
            logger.info(chunk.decode("utf-8", errors="replace").rstrip())
        return child.wait()
    finally:
        if child.poll() is None:
            child.terminate()
            try:
                child.wait(timeout=5)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait()
        handler.close()

if __name__ == "__main__":
    raise SystemExit(main())
