#!/usr/bin/env bash
set -euo pipefail

export AGENT=1

# Fast import check so obvious syntax/module issues fail before the full build
# and benchmark run.
bun --eval "await Promise.all([import('./packages/trees/src/components/Root.tsx'), import('./packages/trees/src/core/create-tree.ts'), import('./packages/trees/src/features/tree/feature.ts'), import('./packages/trees/src/utils/expandPaths.ts'), import('./packages/trees/scripts/benchmarkVirtualizedFileTreeClientMount.ts')]);" >/dev/null

json_file="$(mktemp)"
cleanup() {
  rm -f "$json_file"
}
trap cleanup EXIT

bun ws trees benchmark:render:client -- --json >"$json_file"

bun --eval '
  import { readFileSync } from "node:fs";

  const payload = JSON.parse(readFileSync(process.argv[1], "utf8"));
  if (!Array.isArray(payload.cases) || payload.cases.length !== 1) {
    throw new Error(`Expected exactly one render benchmark case, received ${payload.cases?.length ?? "unknown"}.`);
  }

  const summary = payload.cases[0];
  const clientMount = summary.clientMount;
  if (clientMount == null) {
    throw new Error("Client render benchmark JSON is missing clientMount summary.");
  }

  console.log(`METRIC client_mount_ms=${clientMount.medianMs}`);
  console.log(`METRIC client_mount_p95_ms=${clientMount.p95Ms}`);
  console.log(`METRIC html_items=${summary.renderedItemCount}`);
  console.log(`METRIC expanded_folders=${summary.expandedFolderCount}`);
  console.log(`METRIC shadow_html_length=${summary.shadowHtmlLength}`);
  console.log(`METRIC file_count=${summary.fileCount}`);
' "$json_file"
