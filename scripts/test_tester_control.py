"""Isolated checks for the Tester control queue and protected POST endpoint."""

import importlib.util
import json
import os
from pathlib import Path
import tempfile
import threading
import unittest
from types import SimpleNamespace
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from http.server import ThreadingHTTPServer


SCRIPT = Path(__file__).parent / "tester-control.py"


class TesterControlTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        repo = root / "router"
        (repo / ".git").mkdir(parents=True)
        config = root / "projects.json"
        config.write_text(json.dumps({"projects": {
            "router": {"repo": str(repo), "enabled": True}
        }}), encoding="utf-8")
        values = {
            "TESTER_CONTROL_CONFIG": str(config),
            "TESTER_PRIVATE_REPORT_DIR": str(root / "private"),
            "TESTER_REPORT_DIR": str(root / "public"),
        }
        with patch.dict(os.environ, values):
            spec = importlib.util.spec_from_file_location("tester_control_test", SCRIPT)
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
        self.module = module

    def test_manual_queue_deduplicates_project(self):
        control = self.module
        first = control.enqueue("router", "manual")
        second = control.enqueue("router", "manual")
        self.assertEqual(first["id"], second["id"])
        self.assertEqual(len(control.STATE["pending"]), 1)

    def test_manual_full_run_is_separate_from_project_and_deduplicated(self):
        control = self.module
        first = control.enqueue(control.FULL, "manual")
        self.assertEqual(control.enqueue(control.FULL, "manual")["id"], first["id"])
        control.enqueue("router", "manual")
        self.assertEqual(len(control.STATE["pending"]), 2)

    def test_manual_page_only_offers_scope_selection(self):
        page = self.module.PAGE
        self.assertIn('id="scope"', page)
        self.assertIn('id="run"', page)
        self.assertNotIn('id="mode"', page)
        self.assertNotIn('id="projects"', page)

    def test_test_only_allows_project_without_deployment_adapter(self):
        control = self.module
        control.PROJECTS["node"] = {"repo": "/tmp/node", "enabled": False}
        test = control.enqueue("node", "manual", mode="test")
        self.assertEqual(test["mode"], "test")
        with self.assertRaisesRegex(ValueError, "Deployment adapter"):
            control.enqueue("node", "manual", mode="deploy")
        deploy = control.enqueue("router", "manual", mode="deploy")
        test_same_project = control.enqueue("router", "manual", mode="test")
        self.assertNotEqual(deploy["id"], test_same_project["id"])

    def test_test_only_runs_single_playwright_project_without_git_or_deploy(self):
        control = self.module
        control.PROJECTS["node"] = {"repo": "/tmp/node", "enabled": False}
        item = control.enqueue("node", "manual", mode="test")
        summary = {"request_id": item["id"], "run": "2026-10-17_10-00-00+0800", "status": "passed"}
        with patch.object(control, "cooldown_until", return_value=None), \
             patch.object(control, "git_sha") as git, \
             patch.object(control, "latest_summary", return_value=summary), \
             patch.object(control.subprocess, "run", return_value=SimpleNamespace(returncode=0)) as run:
            self.assertTrue(control.execute(item))
        git.assert_not_called()
        self.assertEqual(run.call_args.args[0], [str(control.TESTER_MAIN_RUNNER), "--project", "node"])
        self.assertEqual(control.STATE["recent"][0]["report"],
                         "/report/projects/node/runs/2026-10-17_10-00-00+0800/index.html")

    def test_full_run_uses_existing_runner_and_records_report(self):
        control = self.module
        item = control.enqueue(control.FULL, "manual")
        summary = {"request_id": item["id"], "run": "2026-10-17_10-00-00+0800", "status": "passed"}
        with patch.object(control, "cooldown_until", return_value=None), \
             patch.object(control, "latest_summary", return_value=summary), \
             patch.object(control.subprocess, "run", return_value=SimpleNamespace(returncode=0)) as run:
            self.assertTrue(control.execute(item))
        self.assertEqual(run.call_args.args[0], [str(control.TESTER_MAIN_RUNNER)])
        self.assertEqual(control.STATE["recent"][0]["result"], "passed")
        self.assertEqual(control.STATE["recent"][0]["report"],
                         "/report/runs/2026-10-17_10-00-00+0800/index.html")

    def test_main_change_enqueues_new_commit(self):
        control = self.module
        old = "a" * 40
        new = "b" * 40
        control.STATE["seen"]["router"] = old
        with patch.object(control, "git_sha", side_effect=[new, new]):
            control.poll_main()
        self.assertEqual(control.STATE["pending"][0]["target_sha"], new)
        self.assertEqual(control.STATE["pending"][0]["source"], "main")

    def test_new_main_during_active_run_stays_queued(self):
        control = self.module
        active = control.enqueue("router", "manual", "a" * 40)
        control.STATE["active"] = control.STATE["pending"].pop(0)
        queued = control.enqueue("router", "main", "b" * 40)
        self.assertNotEqual(active["id"], queued["id"])
        self.assertEqual(active["target_sha"], "a" * 40)
        self.assertEqual(queued["target_sha"], "b" * 40)
        self.assertEqual(len(control.STATE["pending"]), 1)
        self.assertEqual(control.enqueue("router", "main", "c" * 40)["id"], queued["id"])
        self.assertEqual(queued["target_sha"], "c" * 40)

    def test_router_waits_for_shared_rate_limit_window(self):
        control = self.module
        attempt = control.PUBLIC / "projects/router/last-attempt.txt"
        attempt.parent.mkdir(parents=True)
        attempt.write_text("published", encoding="utf-8")
        os.utime(attempt, (1000, 1000))
        with patch.object(control.time, "time", return_value=1000):
            self.assertEqual(control.cooldown_until("router"), 2260)
            self.assertIsNone(control.cooldown_until("books"))
        with patch.object(control.time, "time", return_value=2260):
            self.assertIsNone(control.cooldown_until("router"))

    def test_deferred_project_does_not_block_ready_project(self):
        control = self.module
        control.PROJECTS["books"] = {"repo": "/tmp/books", "enabled": True}
        blocked = control.enqueue("router", "manual")
        ready = control.enqueue("books", "manual")
        blocked["retry_at"] = 2000
        with patch.object(control.time, "time", return_value=1000):
            selected = control.take_ready()
        self.assertEqual(selected["id"], ready["id"])
        self.assertEqual(control.STATE["pending"][0]["id"], blocked["id"])

    def test_new_main_commit_clears_deferred_retry(self):
        control = self.module
        item = control.enqueue("router", "main", "a" * 40)
        item["retry_at"] = 2000
        item["deferred_until"] = "later"
        control.enqueue("router", "main", "b" * 40)
        self.assertEqual(item["target_sha"], "b" * 40)
        self.assertNotIn("retry_at", item)

    def test_tester_main_change_queues_full_on_upstream_commit(self):
        control = self.module
        old = "a" * 40
        new = "b" * 40
        control.STATE["seen"][control.TESTER_MAIN_KEY] = old
        with patch.object(control, "git_sha", side_effect=[new, old]):
            control.poll_tester_main()
        item = control.STATE["pending"][0]
        self.assertEqual((item["project"], item["source"], item["target_sha"]),
                         (control.FULL, "tester-main", new))
        self.assertEqual(control.STATE["seen"][control.TESTER_MAIN_KEY], new)

    def test_new_tester_main_during_full_run_stays_queued(self):
        control = self.module
        active = control.enqueue(control.FULL, "tester-main", "a" * 40)
        control.STATE["active"] = control.STATE["pending"].pop(0)
        queued = control.enqueue(control.FULL, "tester-main", "b" * 40)
        self.assertNotEqual(active["id"], queued["id"])
        self.assertEqual(active["target_sha"], "a" * 40)
        self.assertEqual(control.enqueue(control.FULL, "tester-main", "c" * 40)["id"],
                         queued["id"])
        self.assertEqual(queued["target_sha"], "c" * 40)

    def test_tester_main_report_requires_matching_source_sha(self):
        control = self.module
        item = control.enqueue(control.FULL, "tester-main", "b" * 40)
        summary = {"request_id": item["id"], "run": "2026-10-17_10-00-00+0800",
                   "status": "passed", "tester_sha": "b" * 40}
        with patch.object(control, "cooldown_until", return_value=None), \
             patch.object(control, "latest_summary", return_value=summary), \
             patch.object(control.subprocess, "run", return_value=SimpleNamespace(returncode=0)) as run:
            self.assertTrue(control.execute(item))
        self.assertEqual(run.call_args.args[0], [str(control.TESTER_MAIN_RUNNER), "b" * 40])
        self.assertEqual(control.STATE["recent"][0]["result"], "passed")

    def test_post_requires_origin_and_page_token(self):
        control = self.module
        control.PROJECTS["node"] = {"repo": "/tmp/node", "enabled": False,
                                    "reason": "Deployment not configured"}
        server = ThreadingHTTPServer(("127.0.0.1", 0), control.Handler)
        self.addCleanup(server.server_close)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(server.shutdown)
        url = f"http://127.0.0.1:{server.server_port}/api/run"
        body = b'{"project":"router"}'
        with self.assertRaises(HTTPError) as error:
            urlopen(Request(url, data=body, method="POST"), timeout=2)
        self.assertEqual(error.exception.code, 403)
        request = Request(
            url, data=body, method="POST",
            headers={"Origin": control.ORIGIN, "X-Tester-CSRF": control.CSRF_TOKEN},
        )
        with urlopen(request, timeout=2) as response:
            self.assertEqual(response.status, 202)
        self.assertEqual(len(control.STATE["pending"]), 1)
        self.assertEqual(control.STATE["pending"][0]["mode"], "test")
        full_request = Request(
            url, data=b'{"scope":"full"}', method="POST",
            headers={"Origin": control.ORIGIN, "X-Tester-CSRF": control.CSRF_TOKEN},
        )
        with urlopen(full_request, timeout=2) as response:
            self.assertEqual(response.status, 202)
        test_only_request = Request(
            url, data=b'{"project":"node"}', method="POST",
            headers={"Origin": control.ORIGIN, "X-Tester-CSRF": control.CSRF_TOKEN},
        )
        with urlopen(test_only_request, timeout=2) as response:
            self.assertEqual(response.status, 202)
        deploy_request = Request(
            url, data=b'{"project":"node","mode":"deploy"}', method="POST",
            headers={"Origin": control.ORIGIN, "X-Tester-CSRF": control.CSRF_TOKEN},
        )
        with self.assertRaises(HTTPError) as error:
            urlopen(deploy_request, timeout=2)
        self.assertEqual(error.exception.code, 400)
        self.assertEqual({item["project"] for item in control.STATE["pending"]},
                         {"router", "node", control.FULL})
        with urlopen(f"http://127.0.0.1:{server.server_port}/api/status", timeout=2) as response:
            status = json.load(response)
        self.assertEqual(status["full"]["busy"], "已排队")
        self.assertFalse(status["projects"]["node"]["enabled"])
        self.assertNotIn("log", status["full"])


if __name__ == "__main__":
    unittest.main()
