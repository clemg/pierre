#!/bin/bash
set -euo pipefail

export AGENT=1

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

run_check() {
  local name="$1"
  shift

  local log_file
  log_file="$(mktemp)"

  if "$@" >"$log_file" 2>&1; then
    rm -f "$log_file"
    return 0
  fi

  echo "CHECK FAILED: $name" >&2
  tail -80 "$log_file" >&2
  rm -f "$log_file"
  exit 1
}

run_check "lint" bun run lint
run_check "path-store tsc" bash -lc 'export AGENT=1 && cd packages/path-store && bun run tsc'
run_check "path-store tests" bash -lc 'export AGENT=1 && cd packages/path-store && bun test'
