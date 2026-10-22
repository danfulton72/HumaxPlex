#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
if [[ ! -d "$ROOT/upstream/.git" ]]; then
 git clone --depth=1 https://github.com/rfaile313/samsucks.git "$ROOT/upstream"
fi
python3 "$ROOT/patches/apply.py" "$ROOT/upstream" "$ROOT/android/app/src/main/assets"
