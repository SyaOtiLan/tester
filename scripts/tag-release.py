#!/usr/bin/env python3
"""Explicit release-tag creation; never invoked by package.sh."""
import argparse
import json
from pathlib import Path
import re
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
VERSION = re.compile(r"(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)")

def git(*args, cwd=ROOT):
    return subprocess.check_output(["git", "-C", str(cwd), *args], text=True).strip()

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--bump", choices=("patch", "minor", "major"), default="patch")
    p.add_argument("--unit-version", action="append", default=[])
    args = p.parse_args()
    overrides = {}
    for raw in args.unit_version:
        unit, sep, version = raw.partition("=")
        if sep != "=" or unit != "tester" or not VERSION.fullmatch(version):
            p.error("--unit-version must be tester=MAJOR.MINOR.PATCH")
        if unit in overrides:
            p.error("duplicate unit version")
        overrides[unit] = version
    if git("branch", "--show-current") != "main" or git("status", "--porcelain"):
        p.error("release requires a clean main")
    source = git("rev-parse", "HEAD")
    if source != git("rev-parse", "origin/main"):
        p.error("main must match the selected community origin/main")
    versions = [tuple(map(int, tag[1:].split("."))) for tag in git("tag", "--list", "v*").splitlines()
                if VERSION.fullmatch(tag[1:])]
    current = json.loads((ROOT / "package.json").read_text())["version"]
    versions.append(tuple(map(int, current.split("."))))
    major, minor, patch = max(versions)
    version = f"{major + 1}.0.0" if args.bump == "major" else (
        f"{major}.{minor + 1}.0" if args.bump == "minor" else f"{major}.{minor}.{patch + 1}")
    tag = "v" + version
    # Only the temporary release branch receives version-file changes.
    with tempfile.TemporaryDirectory(prefix="tester-tag-") as folder:
        worktree = Path(folder) / "source"
        git("worktree", "add", "--detach", str(worktree), source)
        try:
            manifest = worktree / "package.json"
            value = json.loads(manifest.read_text())
            value["version"] = version
            manifest.write_text(json.dumps(value, indent=2) + "\n")
            files = ["package.json"]
            if overrides:
                override_file = worktree / "scripts/artifact-versions.conf"
                override_file.write_text("tester " + overrides["tester"] + "\n")
                files.append("scripts/artifact-versions.conf")
            git("add", "--", *files, cwd=worktree)
            git("commit", "-m", "chore(release): " + tag, cwd=worktree)
            release = git("rev-parse", "HEAD", cwd=worktree)
            git("tag", "-a", tag, release, "-m", f"Release {tag}\n\nSource-Commit: {source}")
        finally:
            git("worktree", "remove", str(worktree))
    # An unsuccessful push preserves the tag for explicit retry; never move/delete it.
    git("push", "origin", "refs/tags/" + tag)
    print(f"TAG={tag} SOURCE_COMMIT={source}")

if __name__ == "__main__":
    main()
