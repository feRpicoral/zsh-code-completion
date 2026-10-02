#!/usr/bin/env bash
# Regenerates _code from the help output of an installed Visual Studio Code.
# Usage: scripts/update.sh [path to the code launcher]   (defaults to the code on PATH)

set -euo pipefail

binary="${1:-code}"
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT

node "$root/scripts/generate.mjs" "$binary" > "$workdir/_code"
zsh -n "$workdir/_code"

mv "$workdir/_code" "$root/_code"
"$binary" --version | head -n 1 > "$root/code-version"

echo "Generated _code for Visual Studio Code $(cat "$root/code-version")"
