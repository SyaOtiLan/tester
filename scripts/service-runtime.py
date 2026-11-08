#!/usr/bin/env python3
"""Package-local service lifecycle and read-only acceptance checks."""
import argparse
import contextlib
import fcntl
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import time
import unittest
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]

def environment():
    values = os.environ.copy()
    config = Path(values.get("TESTER_RUNTIME_CONFIG", ROOT / "config/runtime.json"))
    if not config.is_file():
        raise ValueError("Create config/runtime.json from its template")
    raw = json.loads(config.read_text())
    if not isinstance(raw, dict) or any(not isinstance(k, str) or not k.startswith("TESTER_") or not isinstance(v, str) for k, v in raw.items()):
        raise ValueError("runtime configuration must contain TESTER_* string values")
    for key, value in raw.items():
        values.setdefault(key, value)
    values["TESTER_ARTIFACT_MODE"] = "1"
    values["PLAYWRIGHT_BROWSERS_PATH"] = str(ROOT / "browsers")
    values["PYTHONDONTWRITEBYTECODE"] = "1"
    return values

def alive(pid):
    try:
        return Path(f"/proc/{pid}/stat").read_text().split(") ", 1)[1][0] != "Z"
    except (FileNotFoundError, ProcessLookupError):
        return False

def owned(pid):
    try:
        args = Path(f"/proc/{pid}/cmdline").read_bytes().split(b"\0")
        return str(ROOT / "scripts/tester-control.py").encode() in args and os.getpgid(pid) == pid
    except (OSError, ValueError):
        return False

def endpoint(env, path):
    host = env.get("TESTER_CONTROL_HOST", "127.0.0.1")
    if host in ("0.0.0.0", "::"):
        host = "127.0.0.1"
    return "http://" + host + ":" + env.get("TESTER_CONTROL_PORT", "18082") + path

def get_json(env, path, timeout):
    with urlopen(endpoint(env, path), timeout=timeout) as response:
        return json.load(response)

def service(action, env):
    pidfile = Path(env.get("TESTER_PID_FILE", "/data/tester/control.pid"))
    pidfile.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    with pidfile.with_suffix(".lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        pid = int(pidfile.read_text()) if pidfile.exists() else None
        if pid is not None and alive(pid) and not owned(pid):
            raise ValueError("PID ownership mismatch; refusing to signal another process")
        if action in ("stop", "restart") and pid is not None and alive(pid):
            for sig, limit in ((signal.SIGTERM, int(env.get("TESTER_STOP_TIMEOUT", "30"))),
                               (signal.SIGKILL, int(env.get("TESTER_FORCE_STOP_TIMEOUT", "5")))):
                if not alive(pid):
                    break
                if not owned(pid):
                    raise ValueError("Process identity changed during stop")
                os.killpg(pid, sig)
                deadline = time.monotonic() + limit
                while alive(pid) and time.monotonic() < deadline:
                    time.sleep(0.1)
            if alive(pid):
                raise ValueError("Service did not stop")
            pidfile.unlink(missing_ok=True)
            pid = None
        if action == "stop":
            pidfile.unlink(missing_ok=True)
            return
        if pid is not None and alive(pid):
            get_json(env, "/healthz", 3)
            return
        host = env.get("TESTER_CONTROL_HOST", "127.0.0.1")
        with socket.socket() as probe:
            probe.bind((host, int(env.get("TESTER_CONTROL_PORT", "18082"))))
        log = Path(env.get("TESTER_CONTROL_LOG", "/opt/logs/tester-control.log"))
        log.parent.mkdir(parents=True, exist_ok=True)
        if log.exists() and log.stat().st_size > 1048576:
            log.replace(log.with_suffix(".log.1"))
        with log.open("ab") as output:
            process = subprocess.Popen([sys.executable, str(ROOT / "scripts/tester-control.py")],
                                       cwd=ROOT, env=env, stdin=subprocess.DEVNULL,
                                       stdout=output, stderr=output, start_new_session=True)
        pidfile.write_text(str(process.pid) + "\n")
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            if process.poll() is not None:
                pidfile.unlink(missing_ok=True)
                raise ValueError("Control service exited during startup")
            try:
                ready = get_json(env, "/healthz", 1)
                if ready.get("pid") == process.pid:
                    return
            except (OSError, ValueError):
                time.sleep(0.1)
        # A failed start must not leave an unreported process behind.
        if process.poll() is None:
            os.killpg(process.pid, signal.SIGTERM)
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait()
        pidfile.unlink(missing_ok=True)
        raise ValueError("Control service readiness timed out")

def format_result(result, output_format):
    if output_format == "json":
        return json.dumps(result, ensure_ascii=False, indent=2) + "\n"
    if output_format == "junit":
        summary = result["summary"]
        root = ET.Element("testsuite", name="tester", tests=str(summary["total"]),
                          failures=str(summary["failed"]), skipped=str(summary["skipped"]))
        for case in result["cases"]:
            item = ET.SubElement(root, "testcase", name=case["id"], classname="tester",
                                 time=str(case["duration_ms"] / 1000))
            if case["status"] == "fail":
                ET.SubElement(item, "failure", message=case["message"])
        return ET.tostring(root, encoding="unicode") + "\n"
    return "".join(f"[{c['status'].upper()}] {c['id']} {c['message']}\n" for c in result["cases"])

def checks(args, env):
    started = time.time()
    cases = []
    def check(case_id, callback):
        before = time.monotonic()
        try:
            callback()
            status, message = "pass", "check passed"
        except (OSError, ValueError, AssertionError, KeyError, subprocess.SubprocessError):
            status, message = "fail", "check failed; inspect private runtime logs"
        cases.append({"id": case_id, "name": case_id, "status": status,
                      "duration_ms": int((time.monotonic() - before) * 1000), "message": message})

    def ready():
        payload = get_json(env, "/healthz", args.timeout)
        assert payload.get("status") == "pass" and payload.get("unit") == "tester"
        metadata = ROOT / "release.json"
        if metadata.exists():
            assert payload.get("source_commit") == json.loads(metadata.read_text())["source_commit"]

    def dependencies():
        assert (ROOT / "node_modules/@playwright/test/cli.js").is_file()
        assert any((ROOT / "browsers").glob("chromium*"))
        subprocess.run([env.get("TESTER_NODE_BIN", "node"), str(ROOT / "node_modules/@playwright/test/cli.js"), "--version"],
                       env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True, timeout=args.timeout)

    def status():
        payload = get_json(env, "/api/status", args.timeout)
        assert isinstance(payload.get("projects"), dict) and "full" in payload

    def auth():
        request = Request(endpoint(env, "/api/run"), method="POST",
                          data=b'{"scope":"full"}', headers={"Content-Type": "application/json"})
        try:
            urlopen(request, timeout=args.timeout).close()
        except HTTPError as error:
            assert error.code == 403
        else:
            raise AssertionError("unauthenticated scheduling was accepted")

    if args.command == "health":
        level = args.level
        if level in ("liveness", "readiness", "all"):
            check("HEALTH-TESTER-CONTROL", ready)
        if level in ("dependency", "readiness", "all"):
            check("HEALTH-TESTER-RUNNER", dependencies)
    elif args.suite == "unit":
        def units():
            subprocess.run([sys.executable, "-m", "unittest", "discover", "-s", str(ROOT / "scripts"),
                            "-p", "test_*.py"], env=env, cwd=ROOT, stdout=sys.stderr,
                           stderr=sys.stderr, check=True, timeout=args.timeout)
        check("UNIT-TESTER-SCRIPTS", units)
    else:
        for case_id, callback in (("SMOKE-TESTER-001", ready), ("SMOKE-TESTER-002", status),
                                  ("SMOKE-TESTER-003", auth)):
            check(case_id, callback)
    failures = sum(c["status"] == "fail" for c in cases)
    metadata = ROOT / "release.json"
    version = json.loads(metadata.read_text())["version"] if metadata.exists() else "development"
    result = {"schema_version": "1.0", "type": "automated_test", "project": "tester",
              "version": version, "suite": getattr(args, "suite", getattr(args, "level", "readiness")),
              "environment": args.environment, "run_id": os.environ.get("TEST_RUN_ID", f"tester-{time.time_ns()}"),
              "status": "fail" if failures else "pass",
              "started_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(started)),
              "duration_ms": int((time.time() - started) * 1000),
              "summary": {"total": len(cases), "passed": len(cases) - failures, "failed": failures, "skipped": 0},
              "cases": cases}
    rendered = format_result(result, args.format)
    if args.output:
        target = Path(args.output)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(rendered)
    else:
        print(rendered, end="")
    return int(bool(failures))

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("start", "stop", "restart", "health", "test"))
    parser.add_argument("--level", choices=("liveness", "readiness", "dependency", "all"), default="readiness")
    parser.add_argument("--suite", choices=("unit", "smoke"), default="unit")
    parser.add_argument("--format", choices=("text", "json", "junit"), default="text")
    parser.add_argument("--output")
    parser.add_argument("--timeout", type=float, default=30)
    parser.add_argument("--environment", default="test")
    args = parser.parse_args()
    if args.timeout <= 0:
        parser.error("--timeout must be positive")
    try:
        env = environment() if args.command != "test" or args.suite != "unit" else os.environ.copy()
        if args.command in ("start", "stop", "restart"):
            service(args.command, env)
            return 0
        return checks(args, env)
    except (ValueError, OSError, json.JSONDecodeError):
        print("Tester runtime configuration or service operation failed.", file=sys.stderr)
        return 3

if __name__ == "__main__":
    raise SystemExit(main())
