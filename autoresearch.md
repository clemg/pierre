# Autoresearch: speed up large file-tree render

## Objective

Reduce the end-to-end render-path cost for very large file trees in
`@pierre/trees` using the existing render benchmark workload:

`bun ws trees benchmark:render`

This benchmark models the virtualized initial render path for a very large file
list while still requiring the component to ingest the full list of files. The
primary goal is to lower the end-to-end median milliseconds for the benchmark's
`constructAndRender` operation on the default Linux fixture.

Prior optimization work already improved:

- `fileListToTree`
- core `rebuildTree`

This pass should focus on the remaining render pipeline costs, especially work
that happens before virtualization decides which rows to emit.

## Metrics

- **Primary**: `construct_and_render_ms` (ms, lower is better) — benchmark
  median for the `constructAndRender` operation on the default render benchmark.
- **Secondary**:
  - `static_window_render_ms` — isolated SSR cost for rendering the visible
    virtualized window once the instance already exists.
  - `construct_and_render_p95_ms` — tail latency for the end-to-end path.
  - `html_items` — rendered item count checksum guard.
  - `expanded_folders` — expanded folder count checksum guard.

## How to Run

`./autoresearch.sh` — runs the render benchmark and emits structured `METRIC`
lines.

## Files in Scope

- `packages/trees/src/components/Root.tsx` — main render path and virtualized
  item selection.
- `packages/trees/src/components/TreeItem.tsx` — per-row render cost.
- `packages/trees/src/components/hooks/useTree.ts` — tree instance lifecycle.
- `packages/trees/src/components/hooks/useTreeStateConfig.ts` — expanded-path
  and controlled-state mapping.
- `packages/trees/src/core/create-tree.ts` — tree/item instance creation and
  rebuild behavior.
- `packages/trees/src/features/tree/feature.ts` — visible item flattening and
  tree traversal.
- `packages/trees/src/utils/expandPaths.ts` — ancestor expansion mapping.
- `packages/trees/src/utils/fileListToTree.ts` — still in scope only if it
  remains a dominant part of the full render benchmark.
- `packages/trees/scripts/benchmarkVirtualizedFileTreeRender.ts` and
  `packages/trees/scripts/lib/benchmarkVirtualizedRenderRuntime.tsx` —
  instrumentation only when needed for better optimization signal.
- `packages/trees/test/**` — update only when behavior changes are intentional
  and externally correct.

## Off Limits

- Packages outside `packages/trees`.
- Dependency/version changes.
- External API changes unless the gain looks large enough to justify checking
  with the user first.

## Constraints

- Keep changes within `packages/trees`.
- Continue accepting the full incoming file list; partial internal processing is
  allowed if behavior stays correct.
- Prefer improvements that do not change external APIs.
- `bun ws trees test` and `bun ws trees tsc` should pass for kept runs.
- Run `bun run format` from the repo root after edits.
- Favor maintainable refactors over fragile micro-optimizations when gains are
  small or noisy.

## What's Been Tried

- Prior work outside this session already improved `fileListToTree` and core
  `rebuildTree`.
- Initial source review suggested likely remaining hotspots were:
  - building `pathToId` / `idToPath` maps for the entire tree on every render
  - expanding all folder paths through `expandPathsWithAncestors`
  - `createTree` / `rebuildTree` materializing item metadata and item instances
    for the full visible tree before virtualization selects the small render
    window
  - `Root.tsx` computing full `items` arrays and ancestor chains even though
    only a small window is rendered
  - `TreeItem.tsx` per-row structure and spacing generation, though this is less
    likely to dominate than full-tree preprocessing
- ✅ **Kept**: cached visible item IDs in core during `rebuildTree`, changed
  virtualized render paths (`Root.tsx` and the render benchmark runtime) to
  slice/render from those IDs, and still rebuilt the synthetic root item
  instance on each rebuild to preserve the existing `instanceBuilder` contract.
  This cut `construct_and_render_ms` from ~120.3ms to ~58.2ms while keeping
  tests/typecheck green.
- ❌ **Checks-failed prototype**: fully lazy item-instance materialization with
  no rebuild-time root instance refresh achieved a similar win (~57.6ms) but
  broke internal `instanceBuilder` expectations in `test/core/core.test.ts`.
