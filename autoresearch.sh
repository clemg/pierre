#!/usr/bin/env bash
set -euo pipefail

export AGENT=1

# Fast import check so obvious syntax/module issues fail before the full build
# and benchmark run.
bun --eval "await Promise.all([import('./packages/trees/src/components/Root.tsx'), import('./packages/trees/src/core/create-tree.ts'), import('./packages/trees/src/features/tree/feature.ts'), import('./packages/trees/src/utils/expandPaths.ts'), import('./packages/trees/scripts/benchmarkVirtualizedFileTreeRender.ts')]);" >/dev/null

json_file="$(mktemp)"
cleanup() {
  rm -f "$json_file"
}
trap cleanup EXIT

bun ws trees benchmark:render -- --json >"$json_file"

bun --eval '
  import { readFileSync } from "node:fs";

  const payload = JSON.parse(readFileSync(process.argv[1], "utf8"));
  if (!Array.isArray(payload.cases) || payload.cases.length !== 1) {
    throw new Error(`Expected exactly one render benchmark case, received ${payload.cases?.length ?? "unknown"}.`);
  }

  const summary = payload.cases[0];
  const construct = summary.operations?.constructAndRender;
  const renderOnly = summary.operations?.renderStaticWindow;
  if (construct == null || renderOnly == null) {
    throw new Error("Render benchmark JSON is missing operation summaries.");
  }

  console.log(`METRIC construct_and_render_ms=${construct.medianMs}`);
  console.log(`METRIC static_window_render_ms=${renderOnly.medianMs}`);
  console.log(`METRIC construct_and_render_p95_ms=${construct.p95Ms}`);
  console.log(`METRIC static_window_render_p95_ms=${renderOnly.p95Ms}`);
  console.log(`METRIC html_items=${summary.renderedItemCount}`);
  console.log(`METRIC expanded_folders=${summary.expandedFolderCount}`);
  console.log(`METRIC html_length=${summary.htmlLength}`);
  console.log(`METRIC file_count=${summary.fileCount}`);
' "$json_file"
