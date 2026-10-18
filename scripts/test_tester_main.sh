#!/usr/bin/env bash
set -Eeuo pipefail

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
tmp=$(mktemp -d /tmp/tester-main-checkout.XXXXXX)
trap 'case "$tmp" in /tmp/tester-main-checkout.*) rm -rf -- "$tmp" ;; esac' EXIT

git init -q --bare "$tmp/origin.git"
git init -q -b main "$tmp/seed"
git -C "$tmp/seed" config user.name Tester
git -C "$tmp/seed" config user.email tester@example.invalid
printf 'old\n' > "$tmp/seed/example.md"
git -C "$tmp/seed" add example.md
git -C "$tmp/seed" commit -qm old
git -C "$tmp/seed" remote add origin "$tmp/origin.git"
git -C "$tmp/seed" push -q -u origin main
git --git-dir="$tmp/origin.git" symbolic-ref HEAD refs/heads/main
git clone -q "$tmp/origin.git" "$tmp/tester"
mkdir "$tmp/tester/scripts" "$tmp/tester/node_modules"
cp "$script_dir/test-tester-main.sh" "$tmp/tester/scripts/"
touch "$tmp/tester/.env.local"
first=$(git -C "$tmp/tester" rev-parse HEAD)

TESTER_UPSTREAM_CHECKOUT="$tmp/managed" TESTER_LOCK_FILE="$tmp/lock" \
TESTER_PREPARE_ONLY=1 "$tmp/tester/scripts/test-tester-main.sh" "$first"
[[ "$(git -C "$tmp/managed" rev-parse HEAD)" == "$first" ]]
[[ "$(readlink -f "$tmp/managed/.env.local")" == "$tmp/tester/.env.local" ]]
[[ "$(readlink -f "$tmp/managed/node_modules")" == "$tmp/tester/node_modules" ]]

printf 'local edit\n' > "$tmp/tester/example.md"
printf 'new\n' > "$tmp/seed/example.md"
git -C "$tmp/seed" commit -qam new
git -C "$tmp/seed" push -q origin main
second=$(git -C "$tmp/seed" rev-parse HEAD)
TESTER_UPSTREAM_CHECKOUT="$tmp/managed" TESTER_LOCK_FILE="$tmp/lock" \
TESTER_PREPARE_ONLY=1 "$tmp/tester/scripts/test-tester-main.sh" "$second"
[[ "$(git -C "$tmp/managed" rev-parse HEAD)" == "$second" ]]
[[ "$(cat "$tmp/tester/example.md")" == 'local edit' ]]

echo 'Tester checkout: target SHA, separate worktree, shared dependencies, and dirty-tree preservation passed'
