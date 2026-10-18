#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

target=''
project=''
if (( $# == 1 )) && [[ "$1" =~ ^[0-9a-f]{40}$ ]]; then
    target=$1
elif (( $# == 2 )) && [[ "$1" == --project ]]; then
    project=$2
elif (( $# != 0 )); then
    echo 'Usage: test-tester-main.sh [<40-character commit SHA> | --project <name>]' >&2
    exit 2
fi

repo=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
checkout=${TESTER_UPSTREAM_CHECKOUT:-/root/code/tester-upstream}
marker="$checkout/.tester-auto-checkout"
lock=${TESTER_LOCK_FILE:-/run/lock/yeying-tester-full.lock}

# Serialise source changes with every other Tester run, including the daily job.
if [[ "${TESTER_PARENT_LOCK_HELD:-0}" != 1 ]]; then
    exec 9>"$lock"
    if ! flock -n 9; then
        echo 'Tester run already active; retry later.'
        if [[ -n "${TESTER_REQUEST_ID:-}" ]]; then exit 75; fi
        exit 0
    fi
fi

# The operational Tester checkout contains local, uncommitted test-host changes.
# Fetch objects there, but materialize upstream source only in a dedicated worktree.
git -C "$repo" fetch --no-tags origin main
if [[ -z "$target" ]]; then
    target=$(git -C "$repo" rev-parse FETCH_HEAD)
fi
if ! git -C "$repo" cat-file -e "${target}^{commit}"; then
    echo 'Requested Tester commit is unavailable after fetch.' >&2
    exit 76
fi
if ! git -C "$repo" merge-base --is-ancestor "$target" FETCH_HEAD; then
    echo 'Requested Tester commit is no longer on upstream main.' >&2
    exit 76
fi

if [[ ! -e "$checkout" ]]; then
    git -C "$repo" worktree add --detach "$checkout" "$target"
    chmod 700 "$checkout"
    printf '%s\n' "Managed Tester upstream checkout; keep local changes in $repo." > "$marker"
else
    if [[ ! -f "$marker" ]] || [[ "$(readlink -f "$(git -C "$checkout" rev-parse --git-common-dir)")" != "$(readlink -f "$repo/.git")" ]]; then
        echo 'Refusing to use an unmanaged Tester checkout.' >&2
        exit 76
    fi
    if ! git -C "$checkout" diff --quiet || ! git -C "$checkout" diff --cached --quiet; then
        echo 'Managed Tester checkout has local tracked changes; refusing to overwrite them.' >&2
        exit 76
    fi
    git -C "$checkout" checkout --detach "$target"
fi

for name in .env.local node_modules; do
    source_path="$repo/$name"
    target_path="$checkout/$name"
    if [[ ! -e "$source_path" ]]; then
        echo "Tester prerequisite missing: $name" >&2
        exit 76
    fi
    if [[ ! -e "$target_path" ]]; then
        ln -s "$source_path" "$target_path"
    elif [[ "$(readlink -f "$target_path")" != "$(readlink -f "$source_path")" ]]; then
        echo "Managed Tester checkout has a different $name; refusing to replace it." >&2
        exit 76
    fi
done

export TESTER_SOURCE_DIR="$checkout"
export TESTER_SOURCE_SHA="$target"
export TESTER_PARENT_LOCK_HELD=1
if [[ "${TESTER_PREPARE_ONLY:-0}" == 1 ]]; then
    printf 'Prepared Tester upstream checkout at %s\n' "$target"
    exit 0
fi
if [[ -n "$project" ]]; then
    exec "$repo/scripts/run-full-on-test-machine.sh" "$project"
fi
exec "$repo/scripts/run-full-on-test-machine.sh"
