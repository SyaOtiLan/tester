#!/usr/bin/env bash
# Build Agent at an exact main SHA and test an isolated loopback instance.
# The existing Agent services and their working tree are never replaced.
set -Eeuo pipefail
umask 077

sha=${1:-}
[[ "$sha" =~ ^[0-9a-f]{40}$ ]] || exit 2
repo=/root/code/agent
tester=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
release="/data/tester-build/agent-$sha"
port=13900
export PATH=/opt/node-v24/bin:/root/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/bin

[[ "$(git -C "$repo" rev-parse FETCH_HEAD)" == "$sha" ]]
if [[ ! -d "$release" ]]; then
    mkdir -m 0700 -p "$release"
    git -C "$repo" archive "$sha" | tar -x -C "$release"
fi
if [[ ! -f "$release/.tester-build-complete" ]]; then
    (
        cd "$release/hub/backend"
        if ! timeout 240s uv sync --locked --offline --no-progress > "$release/backend-build.log" 2>&1; then
            timeout 480s uv sync --locked --no-progress >> "$release/backend-build.log" 2>&1
        fi
    )
    (
        cd "$release/hub/frontend"
        if cmp -s package.json "$repo/hub/frontend/package.json" &&
           cmp -s package-lock.json "$repo/hub/frontend/package-lock.json" &&
           [[ -d "$repo/hub/frontend/node_modules" ]]; then
            ln -sfnT "$repo/hub/frontend/node_modules" node_modules
        else
            if ! timeout 480s npm ci --no-audit --no-fund > "$release/frontend-install.log" 2>&1; then
                if ! grep -Fq 'can only install packages when' "$release/frontend-install.log"; then
                    echo 'Agent dependency installation failed' >&2
                    exit 1
                fi
                timeout 480s npm install --no-package-lock --no-audit --no-fund \
                    >> "$release/frontend-install.log" 2>&1
            fi
        fi
        timeout 240s npm run build > "$release/frontend-build.log" 2>&1
    )
    [[ -x "$release/hub/backend/.venv/bin/robot-hub" ]]
    [[ -f "$release/hub/frontend/dist/index.html" ]]
    printf '%s\n' "$sha" > "$release/.tester-build-complete"
fi
[[ "$(cat "$release/.tester-build-complete")" == "$sha" ]]
if ss -ltn "sport = :$port" | grep -q ":$port"; then
    echo 'Agent shadow port is occupied; retry later' >&2
    exit 75
fi

set -a
# This file stays on the test machine. Never copy its contents to a report.
source "$repo/config/hub.env"
set +a
runtime="/data/test-results-private/control/agent-shadow/${TESTER_REQUEST_ID:-manual}"
mkdir -m 0700 -p "$runtime"
export HUB_REPO_ROOT="$release"
export HUB_RUNTIME_DIR="$runtime/control-plane"
export HUB_INSTANCES_ROOT="$runtime/instances"
export HUB_BIND_ADDR="127.0.0.1:$port"
export HUB_PUBLIC_BASE_URL="http://127.0.0.1:$port"
export HUB_INSTANCE_PORT_START=19800 HUB_INSTANCE_PORT_END=19899

cd "$release/hub/backend"
.venv/bin/robot-hub > "$runtime/service.log" 2>&1 &
pid=$!
cleanup() {
    kill "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
}
trap cleanup EXIT
ready=0
for attempt in {1..30}; do
    if curl -fsS --max-time 1 "http://127.0.0.1:$port/api/v1/public/health" -o /dev/null 2>/dev/null; then
        ready=1
        break
    fi
    if ! kill -0 "$pid" 2>/dev/null; then
        echo 'Agent shadow service exited before health check' >&2
        exit 1
    fi
    sleep 1
done
[[ "$ready" == 1 ]] || { echo 'Agent shadow health check timed out' >&2; exit 1; }
curl -fsS --max-time 3 "http://127.0.0.1:$port/" -o /dev/null

export AGENT_BASE_URL="http://127.0.0.1:$port"
export AGENT_API_URL="http://127.0.0.1:$port"
export TESTER_PARENT_LOCK_HELD=1 TESTER_TARGET_SHA="$sha"
"$tester/scripts/test-tester-main.sh" --project agent
