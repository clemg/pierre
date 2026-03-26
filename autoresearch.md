# Autoresearch: speed up large file-tree render

## Objective

Reduce the fresh client-mount render cost for very large file trees in
`@pierre/trees` using the new client benchmark workload:

`bun ws trees benchmark:render:client`

This benchmark models a fresh `FileTree.render(...)` mount for a virtualized
Linux file tree in a DOM harness. It still requires the component to ingest the
full file list, run the real client render path, and mount the initial
virtualized window. The primary goal is to lower the median milliseconds for
`clientMount` on the default Linux fixture.

We are keeping the older SSR-oriented `benchmark:render` as a fast sub-benchmark
for isolated data-structure/render-string work, but it is no longer the primary
optimization target because it misses too much of the real fresh-mount path.

Prior optimization work already improved:

- `fileListToTree`
- core `rebuildTree`

This pass should focus on the remaining render pipeline costs, especially work
that happens before virtualization decides which rows to emit.

## Metrics

- **Primary**: `client_mount_ms` (ms, lower is better) — benchmark median for a
  fresh `FileTree.render(...)` client mount on the default Linux fixture.
- **Secondary**:
  - `client_mount_p95_ms` — tail latency for the fresh mount path.
  - `html_items` — rendered item count checksum guard.
  - `shadow_html_length` — mounted shadow-root output size checksum guard.
  - `expanded_folders` — expanded folder count checksum guard.
  - `ssr_construct_and_render_ms` — optional cross-check from the older SSR
    sub-benchmark when needed during diagnosis, but not the primary target.

## How to Run

`./autoresearch.sh` — runs the client-mount benchmark and emits structured
`METRIC` lines.

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
- `packages/trees/scripts/benchmarkVirtualizedFileTreeClientMount.ts` — primary
  fresh client-mount benchmark.
- `packages/trees/scripts/benchmarkVirtualizedFileTreeRender.ts` and
  `packages/trees/scripts/lib/benchmarkVirtualizedRenderRuntime.tsx` — older
  SSR-oriented sub-benchmark and instrumentation helpers.
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
  This cut the older SSR-oriented `construct_and_render_ms` from ~120.3ms to
  ~58.2ms while keeping tests/typecheck green.
- ✅ **Observed / target shift**: a new jsdom client-mount benchmark is a much
  better proxy for the real docs-page button click. On smoke runs it reports
  roughly ~38.8ms for `tiny-flat` and ~153.2ms for the Linux fixture, which is
  much closer to the real-world large-vs-small scaling than the SSR benchmark.
  Future experiments should optimize this client-mount benchmark first.
- ❌ **Checks-failed prototype**: fully lazy item-instance materialization with
  no rebuild-time root instance refresh achieved a similar win (~57.6ms) but
  broke internal `instanceBuilder` expectations in `test/core/core.test.ts`.
