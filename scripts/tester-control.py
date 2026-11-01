#!/usr/bin/env python3
"""Queue per-project Tester runs and watch upstream main branches on the test host."""

from __future__ import annotations

from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import secrets
import subprocess
import tempfile
import threading
import time
from urllib.parse import urlsplit


REPO = Path(__file__).resolve().parents[1]
CONFIG = Path(os.environ.get("TESTER_CONTROL_CONFIG", REPO / "scripts/tester-control-projects.json"))
PRIVATE = Path(os.environ.get("TESTER_PRIVATE_REPORT_DIR", "/data/test-results-private")) / "control"
PUBLIC = Path(os.environ.get("TESTER_REPORT_DIR", "/data/test-results"))
STATE_FILE = PRIVATE / "state.json"
LOG_DIR = PRIVATE / "logs"
RUNNER = REPO / "scripts/deploy-and-test-project.sh"
FULL_RUNNER = REPO / "scripts/run-full-on-test-machine.sh"
TESTER_MAIN_RUNNER = REPO / "scripts/test-tester-main.sh"
FULL = "__full__"
TESTER_MAIN_KEY = "__tester_main__"
ORIGIN = os.environ.get("TESTER_CONTROL_ORIGIN", "https://tester.tidukongjian.com")
POLL_SECONDS = int(os.environ.get("TESTER_MAIN_POLL_SECONDS", "300"))
RETRY_SECONDS = int(os.environ.get("TESTER_PROJECT_RETRY_SECONDS", "300"))
ROUTER_COOLDOWN_SECONDS = int(os.environ.get("TESTER_ROUTER_COOLDOWN_SECONDS", "1260"))
CSRF_TOKEN = secrets.token_urlsafe(32)
MUTEX = threading.RLock()


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def load_config() -> dict[str, dict]:
    raw = json.loads(CONFIG.read_text(encoding="utf-8"))
    projects = raw.get("projects")
    if not isinstance(projects, dict) or not projects:
        raise ValueError("No Tester projects configured")
    for name, value in projects.items():
        if not name.replace("-", "").isalnum() or not isinstance(value, dict):
            raise ValueError("Invalid project configuration")
        repo = Path(value.get("repo", ""))
        if not repo.is_absolute() or (
            value.get("enabled", False) and not (repo / ".git").exists()
        ):
            raise ValueError(f"Project repository is missing: {name}")
    return projects


PROJECTS = load_config()


def save_state(state: dict) -> None:
    PRIVATE.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd, temporary = tempfile.mkstemp(prefix=".state.", dir=PRIVATE)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as output:
            json.dump(state, output, ensure_ascii=False, indent=2)
            output.write("\n")
        os.replace(temporary, STATE_FILE)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def load_state() -> dict:
    if STATE_FILE.exists():
        state = json.loads(STATE_FILE.read_text(encoding="utf-8"))
    else:
        state = {"seen": {}, "pending": [], "active": None, "recent": [], "poll_errors": {}}
    if state.get("active"):
        state["pending"].insert(0, state["active"])
        state["active"] = None
        save_state(state)
    return state


STATE = load_state()


def git_sha(repo: str, remote: bool) -> str:
    command = (
        ["git", "-C", repo, "ls-remote", "origin", "refs/heads/main"]
        if remote else ["git", "-C", repo, "rev-parse", "HEAD"]
    )
    result = subprocess.run(command, capture_output=True, text=True, timeout=35, check=True)
    value = result.stdout.split()[0]
    if len(value) != 40 or any(char not in "0123456789abcdef" for char in value):
        raise ValueError("Invalid Git commit SHA")
    return value


def enqueue(project: str, source: str, target_sha: str | None = None,
            mode: str = "deploy") -> dict:
    if project == FULL:
        mode = "test"
    elif project not in PROJECTS:
        raise ValueError(f"Unknown project: {project}")
    if mode not in ("test", "deploy"):
        raise ValueError("Unknown test mode")
    if project != FULL and mode == "deploy" and not PROJECTS[project].get("enabled", False):
        raise ValueError(f"Deployment adapter is not enabled for {project}")
    # An active run has already selected its commit. A newer main commit must
    # remain in the queue rather than rewriting the running request's SHA.
    active = STATE["active"]
    if active and active["project"] == project and active.get("mode", "deploy") == mode:
        if source not in ("main", "tester-main") or not target_sha or target_sha == active.get("target_sha"):
            return active
    for item in STATE["pending"]:
        if item["project"] == project and item.get("mode", "deploy") == mode:
            if source in ("main", "tester-main") and target_sha:
                item["target_sha"] = target_sha
                item["source"] = source
                item.pop("retry_at", None)
                item.pop("deferred_until", None)
                save_state(STATE)
            return item
    item = {
        "id": secrets.token_hex(12),
        "project": project,
        "mode": mode,
        "source": source,
        "target_sha": target_sha,
        "queued_at": now(),
    }
    STATE["pending"].append(item)
    save_state(STATE)
    return item


def poll_main() -> None:
    for name, config in PROJECTS.items():
        if not config.get("enabled", False):
            continue
        try:
            remote_sha = git_sha(config["repo"], remote=True)
            local_sha = git_sha(config["repo"], remote=False)
            with MUTEX:
                previous = STATE["seen"].get(name)
                if (previous is not None and remote_sha != previous) or (
                    previous is None and remote_sha != local_sha
                ):
                    enqueue(name, "main", remote_sha)
                STATE["seen"][name] = remote_sha
                STATE["poll_errors"].pop(name, None)
                save_state(STATE)
        except (OSError, ValueError, subprocess.SubprocessError) as error:
            with MUTEX:
                STATE["poll_errors"][name] = f"{type(error).__name__}: upstream main check failed"
                save_state(STATE)


def poll_tester_main() -> None:
    try:
        remote_sha = git_sha(str(REPO), remote=True)
        local_sha = git_sha(str(REPO), remote=False)
        with MUTEX:
            previous = STATE["seen"].get(TESTER_MAIN_KEY)
            if (previous is not None and remote_sha != previous) or (
                previous is None and remote_sha != local_sha
            ):
                enqueue(FULL, "tester-main", remote_sha)
            STATE["seen"][TESTER_MAIN_KEY] = remote_sha
            STATE["poll_errors"].pop(TESTER_MAIN_KEY, None)
            save_state(STATE)
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        with MUTEX:
            STATE["poll_errors"][TESTER_MAIN_KEY] = f"{type(error).__name__}: Tester main check failed"
            save_state(STATE)


def latest_summary(project: str) -> dict | None:
    path = (PUBLIC / "latest.json" if project == FULL
            else PUBLIC / "projects" / project / "latest.json")
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return None


def cooldown_until(project: str) -> float | None:
    """Router shares one localhost critical-rate-limit bucket across test runs."""
    if project != "router":
        return None
    attempts = (PUBLIC / "last-attempt.txt", PUBLIC / "projects/router/last-attempt.txt")
    modified = []
    for path in attempts:
        try:
            modified.append(path.stat().st_mtime)
        except FileNotFoundError:
            pass
    if not modified:
        return None
    eligible = max(modified) + ROUTER_COOLDOWN_SECONDS
    return eligible if time.time() < eligible else None


def execute(item: dict) -> bool:
    project = item["project"]
    mode = "test" if project == FULL else item.get("mode", "deploy")
    item.pop("retry_at", None)
    item.pop("deferred_until", None)
    eligible = cooldown_until("router" if project == FULL else project)
    if eligible is not None:
        item["retry_at"] = eligible
        item["deferred_until"] = datetime.fromtimestamp(eligible).astimezone().isoformat(timespec="minutes")
        with MUTEX:
            save_state(STATE)
        return False
    item.pop("deferred_until", None)
    target_sha = None
    if mode == "deploy":
        try:
            target_sha = git_sha(PROJECTS[project]["repo"], remote=True)
        except (OSError, ValueError, subprocess.SubprocessError):
            return False
        item["target_sha"] = target_sha
    with MUTEX:
        save_state(STATE)
    LOG_DIR.mkdir(parents=True, exist_ok=True, mode=0o700)
    log_path = LOG_DIR / f"{item['id']}.log"
    environment = os.environ.copy()
    environment["TESTER_REQUEST_ID"] = item["id"]
    environment["TESTER_TRIGGER"] = item["source"]
    try:
        with log_path.open("w", encoding="utf-8") as log:
            if project == FULL and item["source"] == "tester-main":
                command = [str(TESTER_MAIN_RUNNER), item["target_sha"]]
            elif mode == "test":
                command = [str(TESTER_MAIN_RUNNER)] + ([] if project == FULL else ["--project", project])
            else:
                command = [str(RUNNER), project, target_sha]
            result = subprocess.run(
                command,
                cwd=REPO,
                env=environment,
                stdout=log,
                stderr=subprocess.STDOUT,
                timeout=9700,
                check=False,
            )
        if result.returncode == 75:
            return False
        summary = latest_summary(project)
        published = bool(
            summary
            and summary.get("request_id") == item["id"]
            and (summary.get("tester_sha") == item["target_sha"]
                 if item["source"] == "tester-main"
                 else mode == "test" or summary.get("target_sha") == target_sha)
        )
        record = {
            **item,
            "finished_at": now(),
            "result": summary["status"] if published else "deploy_or_runner_failed",
            "report": (f"/report/runs/{summary['run']}/index.html" if project == FULL
                       else f"/report/projects/{project}/runs/{summary['run']}/index.html") if published else None,
            "log": str(log_path),
        }
        with MUTEX:
            STATE["recent"] = [record, *STATE["recent"]][:30]
            STATE["active"] = None
            save_state(STATE)
        return True
    except (OSError, subprocess.TimeoutExpired) as error:
        with MUTEX:
            STATE["recent"] = [{
                **item, "finished_at": now(), "result": type(error).__name__,
                "report": None, "log": str(log_path),
            }, *STATE["recent"]][:30]
            STATE["active"] = None
            save_state(STATE)
        return True


def take_ready() -> dict | None:
    """Let ready projects run while a blocked project waits for its retry time."""
    with MUTEX:
        current = time.time()
        for index, pending in enumerate(STATE["pending"]):
            if pending.get("retry_at", 0) <= current:
                item = STATE["pending"].pop(index)
                STATE["active"] = item
                save_state(STATE)
                return item
    return None


def poller() -> None:
    while True:
        poll_main()
        poll_tester_main()
        time.sleep(POLL_SECONDS)


def worker() -> None:
    while True:
        item = take_ready()
        if item:
            if not execute(item):
                with MUTEX:
                    STATE["active"] = None
                    if item.get("retry_at", 0) <= time.time():
                        item["retry_at"] = time.time() + RETRY_SECONDS
                        item["deferred_until"] = datetime.fromtimestamp(
                            item["retry_at"]
                        ).astimezone().isoformat(timespec="minutes")
                    STATE["pending"].append(item)
                    save_state(STATE)
        else:
            time.sleep(2)


PAGE = """<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Tester 手动测试</title><style>
body{font:16px system-ui,sans-serif;background:#f5f7fa;color:#17212f;margin:0}
main{max-width:900px;margin:40px auto;padding:0 18px}h1{font-size:26px}
article{background:white;border:1px solid #dae2eb;border-radius:12px;padding:16px 20px;margin:12px 0}
.row{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
button{background:#1768bf;color:white;border:0;border-radius:7px;padding:8px 14px;cursor:pointer}
button:disabled{background:#a6b1bb;cursor:default}a{color:#1768bf}
select{padding:8px;border:1px solid #b7c4d2;border-radius:7px;min-width:210px}
small,.muted{color:#607080}#message{min-height:24px}
</style></head><body><main><p><a href="/report/">← 返回测试报告</a></p>
<h1>手动测试</h1>
<p class="muted">选择全量或一个项目，测试当前已部署的环境。</p>
<article><div class="row"><label for="scope">测试范围</label>
<select id="scope"><option value="">请选择</option><option value="__full__">全量测试</option></select>
<button id="run" disabled>开始测试</button></div>
<p id="selected-status" class="muted"></p><p id="message" role="status"></p>
<a id="latest-report" hidden>查看上次报告 →</a></article>
<script>
const csrf = "__CSRF__";
const scope = document.querySelector("#scope");
const run = document.querySelector("#run");
const status = document.querySelector("#selected-status");
const report = document.querySelector("#latest-report");
let latest = null;
function updateSelection() {
  if (!latest) return;
  const selected = scope.value;
  const info = selected === "__full__" ? latest.full : latest.projects[selected];
  run.disabled = !info || !!info.busy;
  status.textContent = info
    ? (info.busy || (info.last ? "上次：" + info.last.result + " · " + info.last.finished_at : "可运行")) : "";
  report.hidden = !info?.last?.report;
  if (!report.hidden) report.href = info.last.report;
}
scope.onchange = updateSelection;
run.onclick = async () => {
  const selected = scope.value;
  if (!selected || run.disabled) return;
  run.disabled = true;
  try {
    const result = await fetch("api/run", {
      method:"POST", headers:{"Content-Type":"application/json","X-Tester-CSRF":csrf},
      body:JSON.stringify(selected === "__full__" ? {scope:"full"} : {project:selected})
    });
    const body = await result.json();
    document.querySelector("#message").textContent = result.ok
      ? (selected === "__full__" ? "全量测试" : selected) + " 已排队，页面会自动更新。"
      : (body.error || "提交失败");
  } catch { document.querySelector("#message").textContent = "请求失败"; }
  refresh();
};
async function refresh() {
  try {
    const response = await fetch("api/status", {cache:"no-store"});
    if (!response.ok) throw new Error("status unavailable");
    latest = await response.json();
    const previous = scope.value;
    scope.replaceChildren(new Option("请选择", ""), new Option("全量测试", "__full__"));
    for (const name of Object.keys(latest.projects)) scope.add(new Option(name, name));
    scope.value = previous;
    updateSelection();
  } catch {
    latest = null; run.disabled = true; report.hidden = true;
    status.textContent = "状态获取失败，请刷新页面重试";
  }
}
refresh(); setInterval(refresh, 5000);
</script></main></body></html>"""


class Handler(BaseHTTPRequestHandler):
    def reply(self, code: int, payload: bytes, content_type: str) -> None:
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Frame-Options", "DENY")
        self.end_headers()
        self.wfile.write(payload)

    def json_reply(self, code: int, value: dict) -> None:
        self.reply(code, json.dumps(value, ensure_ascii=False).encode(), "application/json; charset=utf-8")

    def do_GET(self) -> None:
        path = urlsplit(self.path).path
        if path == "/":
            self.reply(200, PAGE.replace("__CSRF__", CSRF_TOKEN).encode(), "text/html; charset=utf-8")
            return
        if path != "/api/status":
            self.json_reply(404, {"error": "Not found"})
            return
        with MUTEX:
            def state_for(project: str, config: dict | None = None) -> dict:
                busy = None
                if STATE["active"] and STATE["active"]["project"] == project:
                    busy = ("正在部署或测试" if STATE["active"].get("mode", "deploy") == "deploy"
                            and project != FULL else "正在测试")
                elif any(item["project"] == project for item in STATE["pending"]):
                    pending = next(item for item in STATE["pending"] if item["project"] == project)
                    busy = ("已排队，预计重试 " + pending["deferred_until"]
                            if pending.get("deferred_until") else "已排队")
                last = next((item for item in STATE["recent"] if item["project"] == project), None)
                if last:
                    last = {key: value for key, value in last.items() if key != "log"}
                result = {"busy": busy, "last": last}
                if config is not None:
                    result.update({
                        "enabled": bool(config.get("enabled", False)),
                        "reason": config.get("reason") if not config.get("enabled", False) else None,
                        "poll_error": STATE["poll_errors"].get(project),
                    })
                return result
            values = {}
            for name, config in PROJECTS.items():
                values[name] = state_for(name, config)
            full = state_for(FULL)
        self.json_reply(200, {"full": full, "projects": values})

    def do_POST(self) -> None:
        if urlsplit(self.path).path != "/api/run":
            self.json_reply(404, {"error": "Not found"})
            return
        if self.headers.get("Origin") != ORIGIN or self.headers.get("X-Tester-CSRF") != CSRF_TOKEN:
            self.json_reply(403, {"error": "请刷新页面后重试"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length < 1 or length > 1024:
                raise ValueError("请求大小不正确")
            body = json.loads(self.rfile.read(length))
            if not isinstance(body, dict):
                raise ValueError("请求内容不正确")
            if body.get("mode", "test") != "test":
                raise ValueError("手动测试仅支持当前环境")
            if body.get("scope") == "full" and "project" not in body:
                project = FULL
            else:
                project = body["project"]
            if not isinstance(project, str) or (project != FULL and project not in PROJECTS):
                raise ValueError("未知项目")
            if project == FULL and body.get("scope") != "full":
                raise ValueError("请选择测试范围")
            with MUTEX:
                item = enqueue(project, "manual", mode="test")
            self.json_reply(202, {"id": item["id"], "status": "queued"})
        except (ValueError, KeyError, json.JSONDecodeError) as error:
            self.json_reply(400, {"error": str(error)})


def main() -> None:
    PRIVATE.mkdir(parents=True, exist_ok=True, mode=0o700)
    threading.Thread(target=poller, daemon=True).start()
    thread = threading.Thread(target=worker, daemon=True)
    thread.start()
    host = os.environ.get("TESTER_CONTROL_HOST", "127.0.0.1")
    port = int(os.environ.get("TESTER_CONTROL_PORT", "18082"))
    ThreadingHTTPServer((host, port), Handler).serve_forever()


if __name__ == "__main__":
    main()
