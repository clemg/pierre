#!/bin/bash
set -euo pipefail

export AGENT=1

if ! output=$(bun ws trees test -- test/fileListToTree.test.ts test/drag-and-drop.test.ts 2>&1); then
  printf '%s\n' "$output" | tail -80
  exit 1
fi
