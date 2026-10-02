#!/usr/bin/env bash
# Downloads a macOS build of Visual Studio Code and prints the path to its `code` launcher.
# Usage: scripts/download-vscode.sh <version|latest> <directory>

set -euo pipefail

version="$1"
directory="$2"

mkdir -p "$directory"
curl -fsSL -o "$directory/vscode.zip" "https://update.code.visualstudio.com/$version/darwin-universal/stable"
unzip -q "$directory/vscode.zip" -d "$directory"

echo "$directory/Visual Studio Code.app/Contents/Resources/app/bin/code"
