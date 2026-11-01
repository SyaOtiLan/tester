#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

node_bin=${TESTER_NODE_BIN:-$(command -v node || true)}
export PATH="$(dirname "$node_bin"):/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
export TEST_ENV=local
export TEST_TITLE_LANG=zh
export PWWORKERS=1
export TESTER_SCHEDULED_FULL=1
export TESTER_SOCIAL_UPLOAD_STORAGE_AVAILABLE=0

project=${1:-}
if (( $# > 1 )); then
    echo 'Usage: run-full-on-test-machine.sh [project]' >&2
    exit 2
fi
case "$project" in
    ''|books|chat|marketplace|node|orchestrator|project|router|social|wallet|warehouse) ;;
    *) echo "Unknown or disabled Tester project: $project" >&2; exit 2 ;;
esac
if [[ "$project" == router ]]; then
    # The local Router listens on IPv4; localhost resolves to ::1 for Node here.
    export ROUTER_BASE_URL=http://127.0.0.1:3011
fi

runner_home=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
tester=${TESTER_SOURCE_DIR:-$runner_home}
publisher="$runner_home/scripts/publish-sanitized-report.py"
project_index="$runner_home/scripts/publish-project-report.py"
project_menu="$runner_home/scripts/add-project-menu.py"
bilingual_report="$runner_home/scripts/publish-bilingual-report.py"
notifier="$runner_home/scripts/notify-feishu-report.py"
export TESTER_REPORT_SOURCE="$tester/reports/index.html"
public_root=${TESTER_REPORT_DIR:-/data/test-results}
private_root=${TESTER_PRIVATE_REPORT_DIR:-/data/test-results-private}
public=$public_root
private=$private_root
if [[ -n "$project" ]]; then
    public="$public_root/projects/$project"
    private="$private_root/projects/$project"
fi
export TESTER_PROJECT="$project"
lock=${TESTER_LOCK_FILE:-/run/lock/yeying-tester-full.lock}

if [[ "${TESTER_PARENT_LOCK_HELD:-0}" != 1 ]]; then
    exec 9>"$lock"
    if ! flock -n 9; then
        echo 'Tester run already active; retry later.'
        if [[ -n "$project" || -n "${TESTER_REQUEST_ID:-}" ]]; then exit 75; fi
        exit 0
    fi
fi

stamp=$(date '+%Y-%m-%d_%H-%M-%S%z')
run_dir="$private/$stamp"
mkdir -p "$run_dir" "$public/runs"
if [[ -n "$project" ]]; then
    chmod 755 "$public_root" "$public_root/projects" "$public"
fi
chmod 700 "$private" "$run_dir"
export ROUTER_TEST_AUTH_CACHE_PATH="$run_dir/router-auth-cache.json"
attempt="$public/last-attempt.txt"

write_attempt() {
    local message="$1"
    local temp="$public/.last-attempt.$stamp"
    printf '%s %s\n' "$stamp" "$message" > "$temp"
    chmod 644 "$temp"
    mv -f "$temp" "$attempt"
    printf '%s\n' "$message"
    if [[ "$message" != running:* && -z "$project" ]]; then
        local finished_at
        finished_at=$(date '+%Y-%m-%dT%H:%M:%S%:z')
        if ! python3 "$notifier" --stamp "$stamp" --result "$message" --finished-at "$finished_at"; then
            echo 'Feishu notification failed; report and test result retained.' >&2
        fi
    fi
}

if [[ ! -f "$tester/.env.local" || ! -f "$tester/node_modules/@playwright/test/cli.js" || ! -x "$node_bin" ]]; then
    write_attempt 'skipped: Tester environment or dependencies missing'
    if [[ -n "$project" ]]; then exit 75; fi
    exit 0
fi

available_memory=$(free -b | awk '/^Mem:/ {print $7}')
available_disk=$(df -B1 --output=avail "$public" | tail -n 1 | tr -d ' ')
stuck_chrome=$(ps -eo stat,comm | awk '$1 ~ /^D/ && $2 == "chrome-headless" {n++} END {print n+0}')
stuck_chrome_limit=${TESTER_STUCK_CHROME_LIMIT:-0}
if [[ ! "$stuck_chrome_limit" =~ ^[0-9]+$ ]]; then
    write_attempt 'skipped: invalid TESTER_STUCK_CHROME_LIMIT'
    exit 1
fi
if (( available_memory < 4294967296 || available_disk < 2147483648 )); then
    write_attempt 'skipped: insufficient free memory or disk'
    if [[ -n "$project" ]]; then exit 75; fi
    exit 0
fi
if [[ "$project" != books && "$project" != marketplace ]] && (( stuck_chrome > stuck_chrome_limit )); then
    write_attempt 'skipped: additional Chromium processes are stuck in D state'
    if [[ -n "$project" ]]; then exit 75; fi
    exit 0
fi

cd "$tester"
started=$(date +%s)
if [[ -n "$project" ]]; then
    write_attempt "running: $project Tester suite"
else
    write_attempt 'running: full enabled Tester suite'
fi

playwright_args=(test --config=playwright.safe.config.ts --workers=1)
if [[ -n "$project" ]]; then
    playwright_args+=("--project=$project")
fi

set +e
timeout --signal=TERM --kill-after=30s 9000s \
    xvfb-run -a -s '-screen 0 1920x1080x24' \
    bwrap --die-with-parent \
        --bind / / --dev /dev --proc /proc \
        --tmpfs /run/udev \
        --tmpfs /sys/bus/pci/devices \
        --tmpfs /sys/class/drm \
        --chdir "$tester" \
        "$node_bin" node_modules/@playwright/test/cli.js "${playwright_args[@]}" \
    > "$run_dir/test.log" 2>&1
test_rc=$?
set -e

printf '%s\n' "$test_rc" > "$run_dir/exit-code.txt"
report="$tester/reports/index.html"
if [[ "$test_rc" != 0 && "$test_rc" != 1 ]]; then
    write_attempt "not published: test runner exit code $test_rc; previous report retained"
    exit "$test_rc"
fi
if [[ ! -f "$report" || $(stat -c %Y "$report") -lt "$started" ]]; then
    write_attempt 'not published: no fresh HTML report; previous report retained'
    exit 1
fi

if [[ ! -f "$tester/junit.xml" || $(stat -c %Y "$tester/junit.xml") -lt "$started" ]]; then
    write_attempt 'not published: no fresh JUnit result; previous report retained'
    exit 1
fi
cp "$tester/junit.xml" "$run_dir/junit.xml"

if ! counts=$(python3 - "$run_dir/junit.xml" <<'PY'
import sys
import xml.etree.ElementTree as ET

cases = list(ET.parse(sys.argv[1]).getroot().iter('testcase'))
passed = sum(case.find('failure') is None and case.find('error') is None and case.find('skipped') is None for case in cases)
failed = sum(case.find('failure') is not None or case.find('error') is not None for case in cases)
skipped = sum(case.find('skipped') is not None for case in cases)
print(passed, failed, skipped)
PY
); then
    write_attempt 'not published: invalid JUnit result; previous report retained'
    exit 1
fi
read -r passed failed skipped <<< "$counts"
if (( passed + failed == 0 )); then
    write_attempt "not published: no test executed ($skipped skipped); previous report retained"
    exit 1
fi

published_run="$public/runs/$stamp"
mkdir -p "$published_run"
chmod 755 "$public" "$public/runs" "$published_run"
if ! TESTER_REPORT_TARGET="$published_run/full.html" python3 "$publisher" >> "$run_dir/test.log" 2>&1; then
    write_attempt 'not published: report sanitization failed; previous report retained'
    exit 1
fi

if ! python3 "$project_menu" --report "$published_run/full.html" --junit "$run_dir/junit.xml" >> "$run_dir/test.log" 2>&1; then
    write_attempt 'not published: project menu generation failed; previous report retained'
    exit 1
fi

bilingual_args=(--report "$published_run/full.html" --output "$published_run/full.en.html" --tester "$tester" --node-bin "$node_bin")
if [[ -n "$project" ]]; then bilingual_args+=(--project "$project"); fi
if ! python3 "$bilingual_report" "${bilingual_args[@]}" >> "$run_dir/test.log" 2>&1; then
    write_attempt 'not published: bilingual report generation failed; previous report retained'
    exit 1
fi

if ! python3 "$project_index" --junit "$run_dir/junit.xml" --stamp "$stamp" --output "$published_run/index.html" >> "$run_dir/test.log" 2>&1; then
    write_attempt 'not published: project report generation failed; previous report retained'
    exit 1
fi

for name in full.html full.en.html index.html; do
    temporary="$public/.$name.$stamp"
    cp "$published_run/$name" "$temporary"
    chmod 644 "$temporary"
    mv -f "$temporary" "$public/$name"
done

python3 - "$stamp" "$test_rc" "$run_dir/junit.xml" "$public" "$(date '+%Y-%m-%dT%H:%M:%S%:z')" <<'PY'
from datetime import datetime
import json
import os
from pathlib import Path
import sys
import tempfile
import xml.etree.ElementTree as ET

stamp, exit_code, junit_path, public_path, finished_at = sys.argv[1:]
started_at = datetime.strptime(stamp, '%Y-%m-%d_%H-%M-%S%z').isoformat(timespec='seconds')
datetime.fromisoformat(finished_at)
public = Path(public_path)
counts = {'tests': None, 'passed': None, 'failed': None, 'skipped': None}
if Path(junit_path).exists():
    cases = list(ET.parse(junit_path).getroot().iter('testcase'))
    counts = {
        'tests': len(cases),
        'passed': sum(case.find('failure') is None and case.find('error') is None and case.find('skipped') is None for case in cases),
        'failed': sum(case.find('failure') is not None or case.find('error') is not None for case in cases),
        'skipped': sum(case.find('skipped') is not None for case in cases),
    }
project = os.environ.get('TESTER_PROJECT', '')
summary = {
    'run': stamp,
    'started_at': started_at,
    'finished_at': finished_at,
    'suite': f'project: {project}' if project else 'all enabled projects (Knowledge excluded)',
    'status': 'passed' if exit_code == '0' else 'failed',
    'exit_code': int(exit_code),
    **counts,
    'report': f'runs/{stamp}/index.html',
    'full_report': f'runs/{stamp}/full.html',
}
if project:
    summary['project'] = project
    summary['target_sha'] = os.environ.get('TESTER_TARGET_SHA', '')
    summary['trigger'] = os.environ.get('TESTER_TRIGGER', 'manual')
    summary['request_id'] = os.environ.get('TESTER_REQUEST_ID', '')
    if os.environ.get('TESTER_BUILD_NOTE'):
        summary['build_note'] = os.environ['TESTER_BUILD_NOTE']
elif os.environ.get('TESTER_REQUEST_ID'):
    summary['trigger'] = os.environ.get('TESTER_TRIGGER', 'manual')
    summary['request_id'] = os.environ['TESTER_REQUEST_ID']
if os.environ.get('TESTER_SOURCE_SHA'):
    summary['tester_sha'] = os.environ['TESTER_SOURCE_SHA']
for name in ('latest.json', f'runs/{stamp}/summary.json'):
    target = public / name
    fd, temp = tempfile.mkstemp(prefix='.summary.', dir=target.parent)
    try:
        os.fchmod(fd, 0o644)
        with os.fdopen(fd, 'w', encoding='utf-8') as output:
            json.dump(summary, output, ensure_ascii=False, indent=2)
            output.write('\n')
        os.replace(temp, target)
    finally:
        if os.path.exists(temp):
            os.unlink(temp)
PY

write_attempt "published: test runner exit code $test_rc"
exit "$test_rc"
