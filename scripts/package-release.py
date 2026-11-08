#!/usr/bin/env python3
"""Build a Linux Tester service from committed sources, without publishing."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile

ROOT = Path(__file__).resolve().parents[1]
SEMVER = r"(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)"
FILES = ("package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", ".nvmrc", ".env.template",
         "LICENSE", "README.md", "playwright.config.ts", "playwright.safe.config.ts", "tsconfig.json")
DIRS = ("products", "shared", "scripts", "config", "docs")

def run(args, **kwargs):
    return subprocess.run(args, check=True, **kwargs)

def git(*args):
    return subprocess.check_output(["git", "-C", str(ROOT), *args], text=True).strip()

def sha(path):
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1048576), b""):
            h.update(chunk)
    return h.hexdigest()

def publishable(relative):
    parts = relative.parts
    return not any(p in {".git", "__pycache__", ".cache", ".bin"} or p.startswith(".project") for p in parts) and not (
        relative.name.endswith((".pyc", ".log")) or
        (relative.name.startswith(".env") and relative.name != ".env.template")
    )

def build(args):
    if not re.fullmatch(SEMVER, args.version):
        raise ValueError("version must be major.minor.patch")
    ref = git("rev-parse", "--verify", args.ref + "^{commit}")
    source = git("rev-parse", "--verify", args.source_commit + "^{commit}")
    if not re.fullmatch("[0-9a-f]{40}", args.source_commit) or args.source_commit != source:
        raise ValueError("source-commit must be a full commit SHA")
    run(["git", "-C", str(ROOT), "merge-base", "--is-ancestor", source, ref],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    if sys.platform != "linux" or os.uname().machine not in ("x86_64", "amd64"):
        raise ValueError("this service package currently targets Linux x86_64")
    output = Path(args.output_dir).absolute()
    if output.exists() and (output.is_symlink() or not output.is_dir() or any(output.iterdir())):
        raise ValueError("output-dir must be an empty directory")
    # Read per-unit overrides from the selected release, never from dirty working files.
    override = subprocess.run(["git", "-C", str(ROOT), "show", ref + ":scripts/artifact-versions.conf"],
                              capture_output=True, text=True)
    unit_version = args.version
    if override.returncode == 0:
        for line in override.stdout.splitlines():
            line = line.split("#", 1)[0].strip()
            if line:
                unit, version = line.split()
                if unit != "tester" or not re.fullmatch(SEMVER, version):
                    raise ValueError("invalid Tester artifact version override")
                unit_version = version
    package_root = f"tester-v{unit_version}-{source[:7]}"
    output.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="tester-package-") as temporary:
        temp = Path(temporary)
        checkout = temp / "source"
        checkout.mkdir()
        # git archive reads exactly the selected commit; no fetch, checkout, tags or pushes.
        archive = temp / "source.tar"
        run(["git", "-C", str(ROOT), "archive", "--format=tar", "--output", str(archive), ref])
        with tarfile.open(archive) as tar:
            tar.extractall(checkout, filter="data") if hasattr(tarfile, "data_filter") else tar.extractall(checkout)
        manifest_api = json.loads((checkout / "scripts/package-api.json").read_text())
        if manifest_api["api_version"] != 1:
            raise ValueError("unsupported package API")
        node_version = subprocess.check_output(["node", "-p", "process.versions.node"], text=True).strip()
        major, minor, *_ = map(int, node_version.split("."))
        if (major, minor) < (24, 18):
            raise ValueError("Node.js >=24.18 is required")
        pnpm_version = subprocess.check_output(["pnpm", "--version"], text=True).strip()
        if pnpm_version != "9.15.0":
            raise ValueError("build requires packageManager pnpm@9.15.0")
        # A hoisted tree avoids dependencies pointing back into a build-machine pnpm store.
        env = dict(os.environ, PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD="1")
        run(["pnpm", "install", "--frozen-lockfile", "--config.node-linker=hoisted"], cwd=checkout, env=env)
        browsers = checkout / "browsers"
        env["PLAYWRIGHT_BROWSERS_PATH"] = str(browsers)
        env.pop("PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD", None)
        run(["node", "node_modules/@playwright/test/cli.js", "install", "chromium"], cwd=checkout, env=env)
        staged = temp / package_root
        staged.mkdir()
        for name in FILES:
            shutil.copy2(checkout / name, staged / name)
        for name in (*DIRS, "node_modules", "browsers"):
            shutil.copytree(checkout / name, staged / name, symlinks=True)
        (staged / "release.json").write_text(json.dumps({
            "unit_id": "tester", "version": unit_version, "source_commit": source,
            "release_commit": ref, "platform": "linux-x86_64",
            "node": node_version, "pnpm": pnpm_version,
        }, indent=2) + "\n")
        # Resolve links only when they stay in this release, preventing external build paths.
        for path in list(staged.rglob("*")):
            if path.is_symlink():
                relative = path.relative_to(staged)
                if ".bin" in relative.parts:
                    path.unlink()
                    continue
                resolved = path.resolve(strict=True)
                if not resolved.is_relative_to(staged) or not resolved.is_file():
                    raise ValueError("non-portable dependency link")
                path.unlink()
                shutil.copy2(resolved, path)
        archive_path = temp / (package_root + ".tar.gz")
        def filtered(info):
            relative = Path(info.name).relative_to(package_root)
            if not publishable(relative):
                return None
            info.uid = info.gid = 0
            info.uname = info.gname = ""
            return info
        with tarfile.open(archive_path, "w:gz", dereference=True) as tar:
            tar.add(staged, arcname=package_root, filter=filtered)
        manifest = {
            "schema_version": 1, "repository": "tester", "source_commit": source,
            "artifacts": [{"unit_id": "tester", "type": "service", "version": unit_version,
                           "package": archive_path.name, "sha256": sha(archive_path),
                           "package_root": package_root}],
        }
        manifest_path = temp / "release-manifest.json"
        manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
        # Never replace existing artifact bytes; reserve output names before writing.
        for path in (archive_path, manifest_path):
            with (output / path.name).open("xb") as destination, path.open("rb") as source_file:
                shutil.copyfileobj(source_file, destination)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ref", required=True)
    parser.add_argument("--source-commit", required=True)
    parser.add_argument("--version", required=True)
    parser.add_argument("--output-dir", required=True)
    args = parser.parse_args()
    try:
        build(args)
    except (ValueError, OSError, KeyError, subprocess.SubprocessError, tarfile.TarError):
        print("Tester packaging failed; inspect build output and prerequisites.", file=sys.stderr)
        return 1
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
