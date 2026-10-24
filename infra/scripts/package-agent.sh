#!/usr/bin/env bash
# The AgentCore Python runtime does not include boto3. The zip is arm64,
# which is the only architecture that runtime runs.
set -euo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
dest="$root/infra/build/agent"

rm -rf "$dest"
mkdir -p "$dest"
python3 -m pip install \
  --platform manylinux2014_aarch64 \
  --python-version 3.13 \
  --implementation cp \
  --only-binary=:all: \
  --target "$dest" \
  boto3
cp "$root/agent/main.py" "$root/agent/search.py" "$root/agent/model.py" "$dest/"
python3 -c 'import pathlib, shutil
root = pathlib.Path("'"$dest"'")
for path in root.rglob("__pycache__"):
    shutil.rmtree(path)
'
rm -f "$root/infra/build/agent.zip"
(cd "$dest" && zip -qr "$root/infra/build/agent.zip" .)
