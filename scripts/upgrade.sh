#!/usr/bin/env bash
set -euo pipefail
if (( $# != 3 )); then echo 'Usage: upgrade.sh <prepare|copy-config|post-copy|finalize> <current-dir> <target-dir>' >&2; exit 2; fi
phase=$1; current=$2; target=$3
case "$phase" in
  prepare) test -d "$target/config" ;;
  copy-config)
    for name in runtime.json projects.json .env.local; do
      if [[ ! -e "$target/config/$name" && -f "$current/config/$name" ]]; then
        install -m 600 "$current/config/$name" "$target/config/$name"
      fi
    done ;;
  post-copy|finalize) : ;;
  *) exit 2 ;;
esac
