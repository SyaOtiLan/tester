#!/usr/bin/env python3
"""Package-local service lifecycle and standard health/test interfaces."""
import argparse
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import math
import os
from pathlib import Path
import re
import signal
import socket
import subprocess
import sys
import tempfile
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]

class CleanupError(RuntimeError):
    pass

def cleanup_folder(path):
    import shutil
    try:
        shutil.rmtree(path)
    except OSError as error:
        raise CleanupError("temporary test data cleanup failed") from error
SUITES = ("unit", "integration", "smoke", "e2e", "all")

def environment(config=None, required=True):
    values = os.environ.copy()
    path = Path(config or values.get("TESTER_RUNTIME_CONFIG", ROOT / "config/runtime.json"))
    if path.is_file():
        raw = json.loads(path.read_text())
        if not isinstance(raw, dict) or any(not isinstance(k, str) or not k.startswith("TESTER_") or not isinstance(v, str) for k, v in raw.items()):
            raise ValueError("runtime configuration must contain TESTER_* string values")
        for key, value in raw.items():
            values.setdefault(key, value)
    elif required or config:
        raise ValueError("Create config/runtime.json from its template")
    values["TESTER_ARTIFACT_MODE"] = "1"
    values["PLAYWRIGHT_BROWSERS_PATH"] = str(ROOT / "browsers")
    values["PYTHONDONTWRITEBYTECODE"] = "1"
    return values

def alive(pid):
    try:
        return Path(f"/proc/{pid}/stat").read_text().split(") ", 1)[1][0] != "Z"
    except (OSError, ProcessLookupError):
        return False

def owned(pid):
    try:
        args = Path(f"/proc/{pid}/cmdline").read_bytes().split(b"\0")
        scripts = ("tester-control.py", "service-supervisor.py")
        return any(str(ROOT / "scripts" / name).encode() in args for name in scripts) and os.getpgid(pid) == pid
    except (OSError, ValueError):
        return False

def endpoint(env, path):
    if env.get("TESTER_CHECK_BASE_URL"):
        base = env["TESTER_CHECK_BASE_URL"].rstrip("/")
        parsed = urlsplit(base)
        if parsed.scheme not in ("http", "https") or parsed.username or parsed.password or parsed.query or parsed.fragment:
            raise ValueError("invalid base URL; credentials must not be in URLs")
        return base + path
    host = env.get("TESTER_CONTROL_HOST", "127.0.0.1")
    if host in ("0.0.0.0", "::"):
        host = "127.0.0.1"
    if ":" in host:
        host = "[" + host + "]"
    return "http://" + host + ":" + env.get("TESTER_CONTROL_PORT", "18082") + path

def get_json(env, path, timeout):
    try:
        with urlopen(endpoint(env, path), timeout=timeout) as response:
            return json.load(response)
    except URLError as error:
        if isinstance(error.reason, (TimeoutError, socket.timeout)):
            raise TimeoutError() from error
        raise

def run_command(command, env, timeout, quiet=False, cwd=ROOT):
    child = subprocess.Popen(command, cwd=cwd, env=env, start_new_session=True,
                             stdout=subprocess.DEVNULL if quiet else sys.stderr, stderr=sys.stderr)
    try:
        code = child.wait(timeout=timeout)
        if code:
            raise subprocess.CalledProcessError(code, command)
    except BaseException:
        if child.poll() is None:
            os.killpg(child.pid, signal.SIGTERM)
            try:
                child.wait(timeout=2)
            except subprocess.TimeoutExpired:
                os.killpg(child.pid, signal.SIGKILL)
                child.wait()
        raise

def service(action, env):
    pidfile = Path(env.get("TESTER_PID_FILE", "/data/tester/control.pid"))
    pidfile.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    with pidfile.with_suffix(".lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        pid = int(pidfile.read_text()) if pidfile.exists() else None
        if pid is not None and alive(pid) and not owned(pid):
            raise ValueError("PID ownership mismatch")
        if action in ("stop", "restart") and pid is not None and alive(pid):
            for sig, limit in ((signal.SIGTERM, int(env.get("TESTER_STOP_TIMEOUT", "30"))),
                               (signal.SIGKILL, int(env.get("TESTER_FORCE_STOP_TIMEOUT", "5")))):
                if not alive(pid):
                    break
                if not owned(pid):
                    raise ValueError("process identity changed")
                os.killpg(pid, sig)
                deadline = time.monotonic() + limit
                while alive(pid) and time.monotonic() < deadline:
                    time.sleep(0.1)
            if alive(pid):
                raise RuntimeError("service did not stop")
            pidfile.unlink(missing_ok=True)
            pid = None
        if action == "stop":
            pidfile.unlink(missing_ok=True)
            return
        if pid is not None and alive(pid):
            payload = get_json(env, "/healthz", 3)
            if payload.get("service_pid", payload.get("pid")) != pid:
                raise RuntimeError("readiness identity mismatch")
            return
        host = env.get("TESTER_CONTROL_HOST", "127.0.0.1")
        family = socket.AF_INET6 if ":" in host else socket.AF_INET
        with socket.socket(family) as probe:
            probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            probe.bind((host, int(env.get("TESTER_CONTROL_PORT", "18082"))))
        log = Path(env.get("TESTER_CONTROL_LOG", "/opt/logs/tester-control.log"))
        log.parent.mkdir(parents=True, exist_ok=True)
        process = subprocess.Popen([sys.executable, str(ROOT / "scripts/service-supervisor.py")],
                                   cwd=ROOT, env=env, stdin=subprocess.DEVNULL,
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                   start_new_session=True)
        fd, tmp = tempfile.mkstemp(dir=pidfile.parent, prefix=".pid.")
        with os.fdopen(fd, "w") as output:
            output.write(str(process.pid) + "\n")
        os.replace(tmp, pidfile)
        deadline = time.monotonic() + 10
        try:
            while time.monotonic() < deadline:
                if process.poll() is not None:
                    raise RuntimeError("control service exited")
                try:
                    payload = get_json(env, "/healthz", 1)
                    if payload.get("service_pid") == process.pid and payload.get("status") == "pass":
                        return
                except (OSError, ValueError):
                    pass
                time.sleep(0.1)
            raise RuntimeError("control service readiness timed out")
        except BaseException:
            if process.poll() is None:
                os.killpg(process.pid, signal.SIGTERM)
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid, signal.SIGKILL)
                    process.wait()
            pidfile.unlink(missing_ok=True)
            raise

def format_result(result, output_format, quiet=False):
    if output_format == "json":
        return json.dumps(result, ensure_ascii=False, indent=2) + "\n"
    if output_format == "junit":
        summary = result["summary"]
        root = ET.Element("testsuite", name="tester", tests=str(summary["total"]),
                          failures=str(summary["failed"]), skipped=str(summary["skipped"]),
                          time=str(result.get("duration_ms", 0) / 1000))
        for case in result["cases"]:
            item = ET.SubElement(root, "testcase", name=case["id"], classname="tester",
                                 time=str(case["duration_ms"] / 1000))
            if case["status"] == "fail":
                ET.SubElement(item, "failure", message=case["message"])
            elif case["status"] == "skip":
                ET.SubElement(item, "skipped", message=case["message"])
        return ET.tostring(root, encoding="unicode") + "\n"
    lines = "" if quiet else "".join(f"[{c['status'].upper()}] {c['id']} {c['message']}\n" for c in result["cases"])
    summary = result["summary"]
    return lines + f"RESULT status={result.get('status', 'fail' if summary.get('failed') else 'pass')} passed={summary.get('passed',0)} failed={summary.get('failed',0)} skipped={summary.get('skipped',0)} duration_ms={result.get('duration_ms',0)}\n"

def browser_fixture(env, timeout, keep=False):
    parent = Path(tempfile.mkdtemp(prefix="tester-local-fixture-"))
    try:
        module = json.dumps(str(ROOT / "node_modules/@playwright/test"))
        result_path = parent / "result.json"
        config = "module.exports={testDir:__dirname,testMatch:'fixture.spec.cjs',workers:1,retries:0,use:{headless:true,launchOptions:{args:['--disable-gpu']}},reporter:[['json',{outputFile:" + json.dumps(str(result_path)) + "}]]};"
        (parent / "playwright.config.cjs").write_text(config)
        (parent / "fixture.spec.cjs").write_text("const {test,expect}=require(" + module + ");test('local packaged browser',async({page})=>{await page.setContent('<title>Tester fixture</title>');await expect(page).toHaveTitle('Tester fixture');});")
        run_command([env.get("TESTER_NODE_BIN", "node"), str(ROOT / "node_modules/@playwright/test/cli.js"),
                     "test", "--config=" + str(parent / "playwright.config.cjs")], env, timeout, quiet=True)
        result = json.loads(result_path.read_text())
        if result["stats"]["expected"] != 1 or result["stats"]["unexpected"] != 0 or result["stats"]["skipped"]:
            raise AssertionError("browser fixture was not executed")
    finally:
        if keep:
            print("Retained local fixture: " + str(parent), file=sys.stderr)
        else:
            cleanup_folder(parent)

def specs_from_report(report):
    found = []
    def visit(suites, parents=()):
        for suite in suites:
            path = (*parents, suite.get("title", ""))
            for spec in suite.get("specs", []):
                for test in spec.get("tests", []):
                    label = test.get("projectName", "") + "/" + spec.get("file", suite.get("file", "")) + "/" + "/".join((*path, spec["title"]))
                    label = label.replace(str(ROOT) + "/", "")
                    match = re.search(r"\b[A-Z]{2,}(?:-[A-Z]+)*-\d{3,}\b", spec["title"])
                    identifier = match.group() if match else "E2E-" + hashlib.sha256(label.encode()).hexdigest()[:16]
                    test = dict(test, _identity=label, _file=spec.get("file", suite.get("file", "")), _line=spec.get("line"))
                    found.append((identifier, spec["title"], test))
            visit(suite.get("suites", []), path)
    visit(report.get("suites", []))
    # A repeated product-authored ID must not silently select multiple unrelated cases.
    duplicates = {x[0] for x in found if sum(y[0] == x[0] for y in found) > 1}
    return [(identifier + "-" + hashlib.sha256(test["_identity"].encode()).hexdigest()[:8]
             if identifier in duplicates else identifier, name, test) for identifier, name, test in found]

def e2e_catalog(env, args, timeout):
    if args.environment == "prod" or env.get("TEST_ENV") == "prod":
        raise ValueError("cross-product e2e is disabled in production")
    if not Path(env.get("TESTER_ENV_FILE", "")).is_file():
        raise ValueError("e2e requires an explicit TESTER_ENV_FILE")
    folder = Path(tempfile.mkdtemp(prefix="tester-e2e-"))
    command = [env.get("TESTER_NODE_BIN", "node"), str(ROOT / "node_modules/@playwright/test/cli.js"),
               "test", "--config=" + str(ROOT / "playwright.safe.config.ts"), "--workers=1", "--retries=0", "--reporter=json"]
    if args.project:
        command.append("--project=" + args.project)
    listing = folder / "list.json"
    listing_env = dict(env, PLAYWRIGHT_JSON_OUTPUT_FILE=str(listing), TESTER_RUNTIME_DIR=str(folder))
    try:
        run_command([*command, "--list"], listing_env, timeout, quiet=True)
        catalog = specs_from_report(json.loads(listing.read_text()))
        if not catalog:
            raise ValueError("no e2e tests found")
        return folder, command, catalog
    except BaseException:
        cleanup_folder(folder)
        raise

def checks(args, env):
    started = time.time()
    deadline = time.monotonic() + args.timeout
    cases, exit_code = [], 0
    selected = set(args.case or [])
    catalog = None
    e2e_data = None

    def ready(timeout):
        payload = get_json(env, "/healthz", timeout)
        assert payload.get("status") == "pass" and payload.get("unit") == "tester"
        metadata = ROOT / "release.json"
        if metadata.exists():
            assert payload.get("source_commit") == json.loads(metadata.read_text())["source_commit"]

    def dependencies(timeout):
        assert (ROOT / "node_modules/@playwright/test/cli.js").is_file()
        assert any((ROOT / "browsers").glob("chromium*"))
        if env.get("TESTER_ENV_FILE"):
            assert Path(env["TESTER_ENV_FILE"]).is_file()
        run_command([env.get("TESTER_NODE_BIN", "node"), str(ROOT / "node_modules/@playwright/test/cli.js"), "--version"], env, timeout, quiet=True)

    def status(timeout):
        payload = get_json(env, "/api/status", timeout)
        assert isinstance(payload.get("projects"), dict) and "full" in payload

    def auth(timeout):
        request = Request(endpoint(env, "/api/run"), method="POST", data=b'{"scope":"full"}',
                          headers={"Content-Type": "application/json"})
        try:
            urlopen(request, timeout=timeout).close()
        except HTTPError as error:
            assert error.code == 403
        else:
            raise AssertionError("unauthenticated scheduling was accepted")

    def units(timeout):
        run_command([sys.executable, "-m", "unittest", "discover", "-s", str(ROOT / "scripts"), "-p", "test_*.py"],
                    env, timeout, quiet=args.quiet)

    registered = []
    if args.command == "health":
        if args.level in ("liveness", "readiness", "all"):
            registered.append(("HEALTH-TESTER-CONTROL", ready))
        if args.level in ("dependency", "readiness", "all"):
            registered.append(("HEALTH-TESTER-RUNNER", dependencies))
    else:
        if args.suite in ("unit", "all"):
            registered.append(("UNIT-TESTER-SCRIPTS", units))
        if args.suite in ("integration", "all"):
            registered.append(("INT-TESTER-BROWSER", lambda timeout: browser_fixture(env, timeout, args.keep_data)))
        if args.suite in ("smoke", "all"):
            registered += [("SMOKE-TESTER-001", ready), ("SMOKE-TESTER-002", status), ("SMOKE-TESTER-003", auth)]
    try:
        if args.command == "test" and args.suite in ("e2e", "all"):
            e2e_data = e2e_catalog(env, args, max(0.01, deadline - time.monotonic()))
            catalog = e2e_data[2]
        valid = {identifier for identifier, _ in registered} | {x[0] for x in catalog or []}
        if selected - valid:
            raise ValueError("unknown case ID")
        if args.list_cases:
            if args.format == "json":
                print(json.dumps({"cases": sorted(valid)}))
            else:
                for identifier in sorted(valid):
                    print(identifier)
            return 0
        if not valid:
            raise ValueError("no cases selected")
        for identifier, callback in registered:
            if selected and identifier not in selected:
                continue
            before = time.monotonic()
            status_value, message = "fail", "check failed; inspect private runtime logs"
            case_exit = 1
            attempts = args.retries + 1 if args.command == "health" else 1
            for attempt in range(attempts):
                remaining = args.timeout if args.command == "health" else deadline - time.monotonic()
                if remaining <= 0:
                    case_exit, message = 4, "overall test timeout"
                    break
                try:
                    callback(remaining)
                    status_value, message = "pass", "check passed"
                    break
                except (subprocess.TimeoutExpired, TimeoutError, socket.timeout):
                    case_exit, message = 4, "check timeout"
                except CleanupError:
                    case_exit, message = 5, "temporary data cleanup failed"
                    break
                except FileNotFoundError:
                    case_exit = 3
                except (OSError, ValueError, AssertionError, KeyError, subprocess.SubprocessError):
                    case_exit = 1
                if attempt + 1 < attempts:
                    time.sleep(args.interval)
            if status_value == "fail":
                exit_code = max(exit_code, case_exit)
            cases.append({"id": identifier, "name": identifier, "status": status_value,
                          "duration_ms": int((time.monotonic() - before) * 1000), "message": message, "attempts": attempt + 1})
            if args.fail_fast and status_value == "fail":
                break
        if catalog and not (args.fail_fast and any(c["status"] == "fail" for c in cases)):
            folder, command, catalog = e2e_data
            requested = [x for x in catalog if not selected or x[0] in selected]
            if requested:
                if args.keep_data:
                    raise ValueError("--keep-data is not supported by cross-product e2e cleanup")
                report_path = folder / "result.json"
                run_env = dict(env, PLAYWRIGHT_JSON_OUTPUT_FILE=str(report_path), TESTER_RUNTIME_DIR=str(folder))
                grep = "|".join(re.escape(x[1]) for x in requested)
                locations = sorted({str(x[2]["_file"]) + (":" + str(x[2]["_line"]) if x[2].get("_line") else "") for x in requested}) if selected else []
                command = [*command, *locations, "--grep=" + grep]
                if selected:
                    preview = folder / "selected.json"
                    preview_env = dict(run_env, PLAYWRIGHT_JSON_OUTPUT_FILE=str(preview))
                    run_command([*command, "--list"], preview_env, max(0.01, deadline-time.monotonic()), quiet=True)
                    actual_ids = {x[0] for x in specs_from_report(json.loads(preview.read_text()))}
                    if actual_ids != {x[0] for x in requested}:
                        raise ValueError("case selector was ambiguous; no tests were run")
                if args.fail_fast:
                    command.append("--max-failures=1")
                try:
                    run_command(command, run_env, max(0.01, deadline - time.monotonic()), quiet=args.quiet)
                except subprocess.CalledProcessError:
                    pass
                results = specs_from_report(json.loads(report_path.read_text()))
                for identifier, name, test in results:
                    last = (test.get("results") or [{}])[-1]
                    actual = last.get("status", "interrupted")
                    value = "skip" if actual == "skipped" else ("pass" if actual == "passed" else "fail")
                    cases.append({"id": identifier, "name": name, "status": value,
                                  "duration_ms": last.get("duration", 0),
                                  "message": "Playwright " + actual})
    except subprocess.TimeoutExpired:
        exit_code = 4
        cases.append({"id": "FRAMEWORK-TIMEOUT", "name": "overall timeout", "status": "fail",
                      "duration_ms": 0, "message": "overall test timeout"})
    finally:
        if e2e_data:
            cleanup_folder(e2e_data[0])
    failed = sum(c["status"] == "fail" for c in cases)
    skipped = sum(c["status"] == "skip" for c in cases)
    if not cases or len(cases) == skipped:
        exit_code = 2
    elif not failed:
        exit_code = 0
    else:
        exit_code = exit_code or 1
    metadata = ROOT / "release.json"
    version = json.loads(metadata.read_text())["version"] if metadata.exists() else "development"
    result = {"schema_version": "1.0", "type": "health_check" if args.command == "health" else "automated_test",
              "project": "tester", "version": version, "environment": args.environment,
              "run_id": os.environ.get("TEST_RUN_ID", f"tester-{time.time_ns()}"),
              "status": "fail" if exit_code else "pass",
              "started_at": datetime.fromtimestamp(started, timezone.utc).isoformat(timespec="seconds"),
              "duration_ms": int((time.time() - started) * 1000),
              "summary": {"total": len(cases), "passed": len(cases)-failed-skipped, "failed": failed, "skipped": skipped},
              "cases": cases, "keep_data": args.keep_data}
    result["level" if args.command == "health" else "suite"] = args.level if args.command == "health" else args.suite
    if args.command == "health":
        result["checks"] = cases
    rendered = format_result(result, args.format, args.quiet)
    if args.output:
        target = Path(args.output)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(rendered)
    else:
        print(rendered, end="")
    return exit_code

def number(value):
    result = float(value)
    if not math.isfinite(result):
        raise argparse.ArgumentTypeError("expected a finite number")
    return result

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("start", "stop", "restart", "health", "test", "run"))
    parser.add_argument("--level", choices=("liveness", "readiness", "dependency", "all"), default="readiness")
    parser.add_argument("--suite", choices=SUITES, default=os.environ.get("TEST_SUITE", "unit"))
    parser.add_argument("--format", choices=("text", "json", "junit"), default=None)
    parser.add_argument("--output", default=os.environ.get("TEST_OUTPUT"))
    parser.add_argument("--timeout", type=number, default=None)
    parser.add_argument("--environment", choices=("local", "ci", "test", "staging", "prod"),
                        default=os.environ.get("TEST_ENVIRONMENT", "test"))
    parser.add_argument("--case", action="append", default=[])
    parser.add_argument("--fail-fast", action="store_true")
    parser.add_argument("--keep-data", action="store_true")
    parser.add_argument("--quiet", action="store_true")
    parser.add_argument("--retries", type=int, default=None)
    parser.add_argument("--interval", type=number, default=None)
    parser.add_argument("--config")
    parser.add_argument("--base-url")
    parser.add_argument("--project")
    parser.add_argument("--list-cases", action="store_true")
    args = parser.parse_args()
    health = args.command == "health"
    try:
        args.format = args.format or os.environ.get("HEALTH_FORMAT" if health else "TEST_FORMAT", "text")
        args.timeout = args.timeout if args.timeout is not None else number(os.environ.get("HEALTH_TIMEOUT" if health else "TEST_TIMEOUT", "10" if health else "120"))
        args.retries = args.retries if args.retries is not None else int(os.environ.get("HEALTH_RETRIES", "0")) if health else 0
        args.interval = args.interval if args.interval is not None else number(os.environ.get("HEALTH_INTERVAL", "2"))
        if args.timeout <= 0 or args.retries < 0 or args.interval < 0 or args.format not in ("text", "json", "junit") or args.suite not in SUITES or args.environment not in ("local", "ci", "test", "staging", "prod"):
            raise ValueError()
        if args.project and (not re.fullmatch("[a-z][a-z0-9-]*", args.project) or not (ROOT / "products" / args.project).is_dir()):
            raise ValueError()
        if not health and args.retries:
            raise ValueError("tests do not retry failures")
        if args.keep_data and (args.environment == "prod" or os.environ.get("TEST_ENV") == "prod"):
            raise ValueError("keep-data is disabled in production")
        config = args.config or os.environ.get("HEALTH_CONFIG" if health else "TESTER_RUNTIME_CONFIG")
        required = args.command in ("start", "stop", "restart", "run") or (args.command == "test" and args.suite in ("smoke", "e2e", "all"))
        env = environment(config, required=required)
        base = args.base_url or os.environ.get("HEALTH_BASE_URL" if health else "TEST_BASE_URL")
        if base:
            env["TESTER_CHECK_BASE_URL"] = base
            endpoint(env, "/healthz")
            if args.command == "test" and args.suite in ("e2e", "all"):
                if not args.project:
                    raise ValueError("e2e --base-url requires --project")
                env[args.project.upper().replace("-", "_") + "_BASE_URL"] = base
        if args.command in ("start", "stop", "restart"):
            service(args.command, env)
            return 0
        if args.command == "run":
            projects = json.loads(Path(env["TESTER_CONTROL_CONFIG"]).read_text())["projects"]
            if args.environment == "prod" or env.get("TEST_ENV") == "prod" or args.project and args.project not in projects:
                raise ValueError("invalid product/environment selection")
            if (ROOT / "release.json").exists():
                env["TESTER_SOURCE_SHA"] = json.loads((ROOT / "release.json").read_text())["source_commit"]
            env["TESTER_SOURCE_DIR"] = str(ROOT)
            os.execve(str(ROOT / "scripts/run-full-on-test-machine.sh"),
                      [str(ROOT / "scripts/run-full-on-test-machine.sh")] + ([args.project] if args.project else []), env)
        return checks(args, env)
    except (ValueError, argparse.ArgumentTypeError):
        print("Invalid Tester arguments, configuration or case selection.", file=sys.stderr)
        return 2
    except CleanupError:
        print("Tester temporary data cleanup failed.", file=sys.stderr)
        return 5
    except (OSError, KeyError, RuntimeError, subprocess.SubprocessError):
        print("Tester runtime or service operation failed.", file=sys.stderr)
        return 3

if __name__ == "__main__":
    def interrupted(signum, frame):
        raise KeyboardInterrupt()
    signal.signal(signal.SIGTERM, interrupted)
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        print("Tester execution interrupted; cleanup attempted.", file=sys.stderr)
        raise SystemExit(3)
