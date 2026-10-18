#!/usr/bin/env bash
# Build exact upstream Chat main and test a temporary loopback instance.
# Dirty local Chat source and its existing service are left untouched.
set -Eeuo pipefail
umask 077

sha=${1:-}
[[ "$sha" =~ ^[0-9a-f]{40}$ ]] || exit 2
repo=/root/code/chat
tester=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
release="/data/tester-build/chat-$sha"
port=13020
export PATH=/opt/node-v24/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/bin

[[ "$(git -C "$repo" rev-parse FETCH_HEAD)" == "$sha" ]]
if [[ ! -d "$release" ]]; then
    mkdir -m 0700 -p "$release"
    git -C "$repo" archive "$sha" | tar -x -C "$release"
fi
if [[ -f "$repo/.env" ]]; then
    ln -sfnT "$repo/.env" "$release/.env"
fi
if [[ ! -f "$release/.tester-build-complete" ]]; then
    (
        cd "$release"
        if cmp -s package.json "$repo/package.json" &&
           cmp -s package-lock.json "$repo/package-lock.json" &&
           [[ -d "$repo/node_modules" ]]; then
            ln -sfnT "$repo/node_modules" node_modules
        else
            if ! timeout 600s npm ci --no-audit --no-fund > "$release/install.log" 2>&1; then
                if ! grep -Fq 'can only install packages when' "$release/install.log"; then
                    echo 'Chat dependency installation failed' >&2
                    exit 1
                fi
                timeout 600s npm install --no-package-lock --no-audit --no-fund \
                    >> "$release/install.log" 2>&1
            fi
        fi
        timeout 900s npm run build > "$release/build.log" 2>&1
    )
    [[ -f "$release/.next/standalone/server.js" ]]
    printf '%s\n' "$sha" > "$release/.tester-build-complete"
fi
[[ "$(cat "$release/.tester-build-complete")" == "$sha" ]]
ln -sfnT "$release/.next/static" "$release/.next/standalone/.next/static"
ln -sfnT "$release/public" "$release/.next/standalone/public"
if ss -ltn "sport = :$port" | grep -q ":$port"; then
    echo 'Chat shadow port is occupied; retry later' >&2
    exit 75
fi

runtime="/data/test-results-private/control/chat-shadow/${TESTER_REQUEST_ID:-manual}"
mkdir -m 0700 -p "$runtime"
cd "$release"
PORT="$port" HOSTNAME=127.0.0.1 node .next/standalone/server.js > "$runtime/service.log" 2>&1 &
pid=$!
cleanup() {
    kill "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
}
trap cleanup EXIT
ready=0
for attempt in {1..40}; do
    if curl -fsS --max-time 2 "http://127.0.0.1:$port/" -o /dev/null 2>/dev/null; then
        ready=1
        break
    fi
    if ! kill -0 "$pid" 2>/dev/null; then
        echo 'Chat shadow service exited before health check' >&2
        exit 1
    fi
    sleep 1
done
[[ "$ready" == 1 ]] || { echo 'Chat shadow health check timed out' >&2; exit 1; }

export CHAT_BASE_URL="http://127.0.0.1:$port"
export TESTER_PARENT_LOCK_HELD=1 TESTER_TARGET_SHA="$sha"
"$tester/scripts/test-tester-main.sh" --project chat
