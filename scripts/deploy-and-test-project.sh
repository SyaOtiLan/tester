#!/usr/bin/env bash
# Update the isolated test-machine service to a verified main commit before E2E.
set -Eeuo pipefail
umask 077

project=${1:-}
target_sha=${2:-}
if [[ ! "$target_sha" =~ ^[0-9a-f]{40}$ ]]; then
    echo 'Unsupported project or invalid main commit' >&2
    exit 2
fi
case "$project" in
    router) deployment=service ;;
    chat) deployment=shadow ;;
    books|marketplace|wallet) deployment=source ;;
    *) echo 'Unsupported project or invalid main commit' >&2; exit 2 ;;
esac

tester=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
source_root=${TESTER_SOURCE_ROOT:-/root/code}
repo="$source_root/$project"
private=${TESTER_PRIVATE_REPORT_DIR:-/data/test-results-private}
lock=${TESTER_LOCK_FILE:-/run/lock/yeying-tester-full.lock}
export PATH=/opt/node-v24/bin:/usr/local/go/bin:/usr/local/bin:/usr/bin:/bin

exec 9>"$lock"
if ! flock -n 9; then
    echo 'Tester full or project run is active; retry later.'
    exit 75
fi

if [[ "$deployment" == service ]]; then
    if [[ ! -x "$repo/scripts/starter.sh" || ! -f "$repo/web/package-lock.json" ]]; then
        echo 'Router source or deployment prerequisites are missing' >&2
        exit 1
    fi
    if ! systemctl list-unit-files tester-router.service --no-legend | grep -q '^tester-router.service'; then
        echo 'Independent tester-router.service is required before deployment' >&2
        exit 1
    fi
elif [[ "$project" == wallet && ! -f "$repo/manifest.json" ]]; then
    echo 'Wallet extension manifest is missing' >&2
    exit 1
fi
if [[ "$deployment" != shadow && "$(git -C "$repo" branch --show-current)" != main ]]; then
    echo 'Project checkout is not on main; preserving it' >&2
    exit 1
fi
if [[ "$deployment" != shadow ]] &&
   { ! git -C "$repo" diff --quiet || ! git -C "$repo" diff --cached --quiet; }; then
    echo 'Project has tracked local changes; preserving them and refusing automatic update' >&2
    exit 1
fi
if (( $(free -b | awk '/^Mem:/ {print $7}') < 4294967296 )); then
    echo 'Insufficient available memory to build and test project' >&2
    exit 75
fi
mkdir -p "$private"
if (( $(df -B1 --output=avail "$private" | tail -n 1) < 4294967296 )); then
    echo 'Insufficient free disk to build and test project' >&2
    exit 75
fi
stuck_chrome=$(ps -eo stat,comm | awk '$1 ~ /^D/ && $2 == "chrome-headless" {n++} END {print n+0}')
stuck_chrome_limit=${TESTER_STUCK_CHROME_LIMIT:-3}
if [[ ! "$stuck_chrome_limit" =~ ^[0-9]+$ ]] ||
   { [[ "$project" != books && "$project" != marketplace ]] && (( stuck_chrome > stuck_chrome_limit )); }; then
    echo 'Chromium is stuck; deferring source update and project test' >&2
    exit 75
fi

git -C "$repo" fetch --no-tags origin main
fetched=$(git -C "$repo" rev-parse FETCH_HEAD)
if [[ "$fetched" != "$target_sha" ]]; then
    echo 'main advanced during fetch; retry with its new commit'
    exit 75
fi
if [[ "$deployment" == shadow ]]; then
    export TESTER_TARGET_SHA="$target_sha"
    "$tester/scripts/deploy-and-test-$project.sh" "$target_sha"
    exit $?
fi
git -C "$repo" merge --ff-only "$target_sha"
current=$(git -C "$repo" rev-parse HEAD)
if [[ "$current" != "$target_sha" ]]; then
    echo 'Project source does not match the requested main commit' >&2
    exit 1
fi

if [[ "$deployment" == source ]]; then
    case "$project" in
        books) export BOOKS_REPO_PATH="$repo" ;;
        marketplace) export MARKETPLACE_REPO_PATH="$repo" ;;
        wallet) export WALLET_REPO_PATH="$repo" WALLET_EXTENSION_PATH="$repo" ;;
    esac
    export TESTER_PARENT_LOCK_HELD=1 TESTER_TARGET_SHA="$target_sha"
    "$tester/scripts/test-tester-main.sh" --project "$project"
    exit $?
fi

backup_dir="$private/control/backups"
mkdir -p "$backup_dir"
chmod 700 "$backup_dir"
old_binary="$repo/build/router"
backup="$backup_dir/router-before-$target_sha.bin"
if [[ ! -x "$old_binary" ]]; then
    echo 'Current Router binary is missing; refusing automated replacement' >&2
    exit 1
fi
deployed_file="$private/control/deployed-router.txt"
if [[ -f "$deployed_file" ]]; then
    read -r deployed_sha deployed_hash deployed_note < "$deployed_file"
    actual_hash=$(sha256sum "$old_binary" | awk '{print $1}')
    if [[ "$deployed_sha" == "$target_sha" && "$deployed_hash" == "$actual_hash" ]]; then
        if ! systemctl is-active --quiet tester-router.service; then
            systemctl start tester-router.service
        fi
        running_pid=$(cat "$repo/run/router.pid")
        if [[ "$(sha256sum "/proc/$running_pid/exe" | awk '{print $1}')" != "$actual_hash" ]]; then
            systemctl restart tester-router.service
        fi
        "$repo/scripts/health-check.sh" --level readiness --wait 30 --quiet
        export TESTER_PARENT_LOCK_HELD=1
        export TESTER_TARGET_SHA="$target_sha"
        if [[ -n "${deployed_note:-}" ]]; then export TESTER_BUILD_NOTE="$deployed_note"; fi
        "$tester/scripts/test-tester-main.sh" --project "$project"
        exit $?
    fi
fi
if [[ ! -e "$backup" ]]; then
    cp -p "$old_binary" "$backup"
fi

# The service binary embeds web/dist. Build the new artifact before stopping it.
npm_log="$backup_dir/npm-$target_sha.log"
if ! npm ci --prefix "$repo/web" --no-audit --no-fund > "$npm_log" 2>&1; then
    cat "$npm_log" >&2
    if ! grep -Fq 'can only install packages when' "$npm_log"; then
        echo 'npm ci failed for a reason other than a lock-file mismatch' >&2
        exit 1
    fi
    echo 'Router main has a mismatched npm lock file; using package.json without changing tracked files' >&2
    npm install --prefix "$repo/web" --no-package-lock --no-audit --no-fund
    export TESTER_BUILD_NOTE=npm_lock_mismatch_used_manifest
fi
npm run build --prefix "$repo/web"
[[ -f "$repo/web/dist/index.html" ]]
new_binary="$backup_dir/router-$target_sha.new"
(cd "$repo" && go build -o "$new_binary" ./cmd/router)
[[ -x "$new_binary" ]]
if ! git -C "$repo" diff --quiet || ! git -C "$repo" diff --cached --quiet; then
    echo 'Router build modified tracked source files; refusing deployment' >&2
    exit 1
fi

rollback() {
    local rc=$?
    if [[ -f "$backup" ]]; then
        echo 'Router deployment or health check failed; restoring previous binary' >&2
        systemctl stop tester-router.service || true
        install -m 0755 "$backup" "$old_binary"
        systemctl start tester-router.service || true
        "$repo/scripts/health-check.sh" --level readiness --wait 30 --quiet || true
    fi
    exit "$rc"
}

systemctl stop tester-router.service
trap rollback ERR
install -m 0755 "$new_binary" "$old_binary"
systemctl start tester-router.service
"$repo/scripts/health-check.sh" --level readiness --wait 30 --quiet
running_pid=$(cat "$repo/run/router.pid")
[[ "$(sha256sum "/proc/$running_pid/exe" | awk '{print $1}')" == "$(sha256sum "$old_binary" | awk '{print $1}')" ]]
trap - ERR
printf '%s %s %s\n' "$target_sha" "$(sha256sum "$old_binary" | awk '{print $1}')" "${TESTER_BUILD_NOTE:-clean_lock}" > "$deployed_file.new"
mv -f "$deployed_file.new" "$deployed_file"
rm -f "$new_binary"

export TESTER_PARENT_LOCK_HELD=1
export TESTER_TARGET_SHA="$target_sha"
"$tester/scripts/test-tester-main.sh" --project "$project"
