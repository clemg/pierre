#!/usr/bin/env bash
set -euo pipefail

export AGENT=1

log_file="$(mktemp)"
cleanup() {
  rm -f "$log_file"
}
trap cleanup EXIT

if ! bun ws trees test >"$log_file" 2>&1; then
  tail -80 "$log_file"
  exit 1
fi

: >"$log_file"
if ! bun ws trees tsc >"$log_file" 2>&1; then
  tail -80 "$log_file"
  exit 1
fi
