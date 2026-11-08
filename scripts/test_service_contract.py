"""Offline checks for standardized selectors, failures, cleanup and rotation."""
import argparse
import contextlib
import importlib.util
import io
import json
import logging
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]

def module(name):
    spec = importlib.util.spec_from_file_location("contract_" + name.replace("-", "_"), ROOT / "scripts" / (name + ".py"))
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result

def arguments(**changes):
    values = dict(command="test", suite="unit", timeout=5, case=[], list_cases=False,
                  fail_fast=False, quiet=False, keep_data=False, retries=0, interval=0,
                  project=None, format="json", output=None, environment="test", level="liveness")
    values.update(changes)
    return argparse.Namespace(**values)

class ServiceContractTests(unittest.TestCase):
    def setUp(self):
        self.runtime = module("service-runtime")

    def test_unknown_case_is_rejected_before_any_command(self):
        with patch.object(self.runtime, "run_command") as command:
            with self.assertRaises(ValueError):
                self.runtime.checks(arguments(case=["UNKNOWN"]), {})
        command.assert_not_called()

    def test_known_case_selection_returns_one_json_result(self):
        stdout = io.StringIO()
        with patch.object(self.runtime, "run_command"), contextlib.redirect_stdout(stdout):
            code = self.runtime.checks(arguments(case=["UNIT-TESTER-SCRIPTS"]), {})
        self.assertEqual(code, 0)
        self.assertEqual(json.loads(stdout.getvalue())["summary"]["passed"], 1)

    def test_timeout_returns_four_and_preserves_failure(self):
        stdout = io.StringIO()
        with patch.object(self.runtime, "run_command", side_effect=subprocess.TimeoutExpired("unit", 1)), contextlib.redirect_stdout(stdout):
            code = self.runtime.checks(arguments(), {})
        self.assertEqual(code, 4)
        self.assertEqual(json.loads(stdout.getvalue())["summary"]["failed"], 1)

    def test_health_retry_is_explicit_and_success_clears_failure(self):
        stdout = io.StringIO()
        with patch.object(self.runtime, "get_json", side_effect=[OSError(), {"status": "pass", "unit": "tester", "source_commit": json.loads((ROOT / "release.json").read_text())["source_commit"] if (ROOT / "release.json").exists() else None}]) as check, contextlib.redirect_stdout(stdout):
            code = self.runtime.checks(arguments(command="health", retries=1), {})
        self.assertEqual(code, 0)
        self.assertEqual(check.call_count, 2)
        self.assertEqual(json.loads(stdout.getvalue())["type"], "health_check")

    def test_test_failures_are_not_retried_and_fail_fast_stops(self):
        stdout = io.StringIO()
        with patch.object(self.runtime, "get_json", side_effect=OSError()) as check, contextlib.redirect_stdout(stdout):
            code = self.runtime.checks(arguments(suite="smoke", fail_fast=True), {})
        self.assertEqual(code, 1)
        self.assertEqual(check.call_count, 1)
        self.assertEqual(json.loads(stdout.getvalue())["summary"]["total"], 1)

    def test_cleanup_failure_returns_five(self):
        stdout = io.StringIO()
        with patch.object(self.runtime, "browser_fixture", side_effect=self.runtime.CleanupError()), contextlib.redirect_stdout(stdout):
            code = self.runtime.checks(arguments(suite="integration"), {})
        self.assertEqual(code, 5)
        self.assertEqual(json.loads(stdout.getvalue())["status"], "fail")

    def test_invalid_flags_and_prod_keep_data_return_two(self):
        for flags in [("--timeout", "nan"), ("--retries", "1"),
                      ("--case", "UNKNOWN"), ("--keep-data", "--environment", "prod")]:
            result = subprocess.run([sys.executable, str(ROOT / "scripts/service-runtime.py"), "test", *flags],
                                    capture_output=True, text=True)
            self.assertEqual(result.returncode, 2, result.stderr)

    def test_json_and_junit_preserve_skipped_counts(self):
        value = {"status": "pass", "summary": {"total": 2, "passed": 1, "failed": 0, "skipped": 1},
                 "cases": [{"id": "one", "status": "pass", "duration_ms": 1, "message": "ok"},
                           {"id": "two", "status": "skip", "duration_ms": 0, "message": "not applicable"}]}
        self.assertEqual(json.loads(self.runtime.format_result(value, "json"))["summary"]["skipped"], 1)
        self.assertIn("<skipped ", self.runtime.format_result(value, "junit"))

    def test_rotating_logs_have_bounded_size_and_backups(self):
        supervisor = module("service-supervisor")
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "control.log"
            handler = supervisor.rotating_handler(path, max_bytes=1024, backups=2)
            logger = logging.Logger("rotation-fixture")
            logger.addHandler(handler)
            try:
                for _ in range(80):
                    logger.info("x" * 100)
            finally:
                handler.close()
            self.assertTrue(path.with_suffix(".log.1").exists())
            self.assertLessEqual(len(list(Path(folder).glob("control.log*"))), 3)
            self.assertTrue(all(p.stat().st_size <= 1024 for p in Path(folder).glob("control.log*")))

    def test_tag_changes_only_release_commit_and_pushes_only_to_local_fixture(self):
        import shutil
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            origin, repo = root / "origin.git", root / "source"
            def git(*args, cwd=repo):
                return subprocess.check_output(["git", "-c", "user.name=Fixture",
                    "-c", "user.email=fixture@example.invalid", "-C", str(cwd), *args],
                    text=True, stderr=subprocess.DEVNULL).strip()
            origin.mkdir(); git("init", "--bare", cwd=origin)
            repo.mkdir(); git("init", "-b", "main")
            (repo / "scripts").mkdir()
            for name in ("tag.sh", "tag-release.py"):
                shutil.copy2(ROOT / "scripts" / name, repo / "scripts" / name)
            (repo / "package.json").write_text('{"version":"0.1.0"}')
            git("config", "user.name", "Fixture")
            git("config", "user.email", "fixture@example.invalid")
            git("add", "."); git("commit", "-m", "fixture")
            git("remote", "add", "origin", str(origin)); git("push", "-u", "origin", "main")
            baseline = git("rev-parse", "HEAD")
            subprocess.run(["bash", "scripts/tag.sh", "--bump", "minor", "--unit-version", "tester=7.8.9"],
                           cwd=repo, check=True, capture_output=True)
            self.assertEqual(git("rev-parse", "HEAD"), baseline)
            self.assertEqual(git("rev-parse", "refs/heads/main", cwd=origin), baseline)
            self.assertIn("Source-Commit: " + baseline, git("for-each-ref", "--format=%(contents)", "refs/tags/v0.2.0"))
            self.assertEqual(json.loads(git("show", "v0.2.0:package.json"))["version"], "0.2.0")
            self.assertEqual(git("show", "v0.2.0:scripts/artifact-versions.conf"), "tester 7.8.9")

    def test_e2e_report_parser_keeps_skips_and_stable_ids(self):
        report = {"suites": [{"title": "root", "specs": [
            {"title": "RT-API-001 fixture", "file": "products/router/tests/x.spec.ts", "line": 2,
             "tests": [{"projectName": "router", "results": [{"status": "skipped"}]}]}]}]}
        cases = self.runtime.specs_from_report(report)
        self.assertEqual(cases[0][0], "RT-API-001")
        self.assertEqual(cases[0][2]["results"][0]["status"], "skipped")

    def test_upgrade_copies_private_config_without_overwriting_target(self):
        with tempfile.TemporaryDirectory() as folder:
            current, target = [Path(folder) / name for name in ("old", "new")]
            for root in (current, target):
                (root / "config").mkdir(parents=True)
            (current / "config/runtime.json").write_text('{"TESTER_CONTROL_PORT":"1"}')
            (current / "config/projects.json").write_text('{"projects":{}}')
            (target / "config/runtime.json").write_text('{"TESTER_CONTROL_PORT":"2"}')
            for _ in range(2):
                subprocess.run(["bash", str(ROOT / "scripts/upgrade.sh"), "copy-config", str(current), str(target)], check=True)
            self.assertIn('"2"', (target / "config/runtime.json").read_text())
            self.assertEqual((current / "config/projects.json").read_bytes(), (target / "config/projects.json").read_bytes())
            self.assertEqual((target / "config/projects.json").stat().st_mode & 0o777, 0o600)

if __name__ == "__main__":
    unittest.main()
