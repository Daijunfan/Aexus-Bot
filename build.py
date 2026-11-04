#!/usr/bin/env python3
"""Build the macOS 0.58.1 app through its original packaging pipeline."""
from pathlib import Path
import os
import subprocess

root = Path(__file__).resolve().parent
cache = root / "artifacts" / "cache"
for name in ("npm", "electron", "tmp"):
    (cache / name).mkdir(parents=True, exist_ok=True)
env = {
    **os.environ,
    "npm_config_cache": str(cache / "npm"),
    "ELECTRON_CACHE": str(cache / "electron"),
    "TMPDIR": str(cache / "tmp"),
}
subprocess.run(["npm", "run", "app"], cwd=root, env=env, check=True)
print(root / "release" / "mac-arm64" / "Aexus Bot.app")
