"""Offline package-contract tests; fixture tools never call product services."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]

def module(name):
    spec = importlib.util.spec_from_file_location("tester_" + name.replace("-", "_"), ROOT / "scripts" / (name + ".py"))
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result

class PackageContractTests(unittest.TestCase):
    def test_runtime_configuration_never_accepts_arbitrary_environment_keys(self):
        runtime = module("service-runtime")
        with tempfile.TemporaryDirectory() as folder:
            config = Path(folder) / "runtime.json"
            config.write_text('{"PATH":"/untrusted"}')
            with patch.dict(os.environ, {"TESTER_RUNTIME_CONFIG": str(config)}):
                with self.assertRaises(ValueError):
                    runtime.environment()

    def test_report_formats_preserve_failures_and_skip_counts(self):
        runtime = module("service-runtime")
        value = {"summary": {"total": 1, "failed": 1, "skipped": 0},
                 "cases": [{"id": "SMOKE-TESTER-001", "status": "fail", "duration_ms": 20, "message": "failure"}]}
        self.assertEqual(json.loads(runtime.format_result(value, "json"))["summary"]["failed"], 1)
        self.assertIn('<failure ', runtime.format_result(value, "junit"))
        self.assertIn("[FAIL]", runtime.format_result(value, "text"))

    def test_package_filter_excludes_secrets_caches_and_local_state(self):
        build = module("package-release")
        for name in ("scripts/__pycache__/x.pyc", "scripts/.env.local", ".project/task.json", "x.log"):
            self.assertFalse(build.publishable(Path(name)))
        for name in ("config/runtime.json.template", ".env.template", "products/router/tests/smoke.spec.ts"):
            self.assertTrue(build.publishable(Path(name)))

    def test_invalid_release_version_is_rejected_before_building(self):
        proc = subprocess.run(["bash", str(ROOT / "scripts/package.sh"), "--ref", "HEAD",
                               "--source-commit", "0" * 40, "--version", "../../invalid", "--output-dir", "/invalid"],
                              capture_output=True, text=True)
        self.assertNotEqual(proc.returncode, 0)

    def test_stale_or_foreign_pid_is_never_owned(self):
        runtime = module("service-runtime")
        self.assertFalse(runtime.owned(os.getpid()))


class ArtifactServiceTests(unittest.TestCase):
    def test_isolated_service_can_start_smoke_and_stop_without_git_or_products(self):
        import socket
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            with socket.socket() as listener:
                listener.bind(("127.0.0.1", 0))
                port = listener.getsockname()[1]
            projects = root / "projects.json"
            projects.write_text(json.dumps({"projects": {"router": {"repo": "/not-a-checkout", "enabled": False}}}))
            config = root / "runtime.json"
            config.write_text(json.dumps({
                "TESTER_CONTROL_CONFIG": str(projects),
                "TESTER_CONTROL_HOST": "127.0.0.1",
                "TESTER_CONTROL_PORT": str(port),
                "TESTER_PRIVATE_REPORT_DIR": str(root / "private"),
                "TESTER_REPORT_DIR": str(root / "reports"),
                "TESTER_PID_FILE": str(root / "control.pid"),
                "TESTER_CONTROL_LOG": str(root / "control.log"),
            }))
            env = dict(os.environ, TESTER_RUNTIME_CONFIG=str(config))
            def run(*args):
                return subprocess.run(["bash", str(ROOT / "scripts" / args[0]), *args[1:]],
                                      env=env, capture_output=True, text=True, timeout=20)
            try:
                started = run("starter.sh", "start")
                self.assertEqual(started.returncode, 0, started.stderr)
                smoke = run("test.sh", "--suite", "smoke", "--format", "json")
                self.assertEqual(smoke.returncode, 0, smoke.stderr)
                report = json.loads(smoke.stdout)
                self.assertEqual(report["summary"], {"total": 3, "passed": 3, "failed": 0, "skipped": 0})
                path = root / "private/control/state.json"
                state = json.loads(path.read_text()) if path.exists() else {}
                self.assertFalse(state.get("pending"))
                self.assertFalse(state.get("poll_errors"))
            finally:
                stopped = run("starter.sh", "stop")
                self.assertEqual(stopped.returncode, 0, stopped.stderr)
                self.assertFalse((root / "control.pid").exists())

if __name__ == "__main__":
    unittest.main()
