# Autoresearch: trees fileListToTree linux fixture performance

## Objective
Reduce `fileListToTree` runtime for the large `fixture-linux-kernel-files` workload in `@pierre/trees` without changing behavior.

The loop benchmarks only the linux fixture to maximize iteration speed and uses repeated benchmark executions per experiment point to reduce noise.

## Metrics
- **Primary**: `linux_total_median_ms` (ms, lower is better) — median of per-run `medianMs` for the linux fixture.
- **Secondary**:
  - `linux_buildPathGraph_median_ms`
  - `linux_buildFlattenedNodes_median_ms`
  - `linux_buildFolderNodes_median_ms`
  - `linux_hashTreeKeys_median_ms`
  - `linux_total_p95_ms`

## How to Run
`./autoresearch.sh` — emits structured `METRIC name=value` lines.

## Files in Scope
- `packages/trees/src/utils/fileListToTree.ts` — main tree-construction pipeline and stage implementations.
- `packages/trees/src/utils/createLoaderUtils.ts` — flattening helpers used by the tree builder.
- `packages/trees/src/utils/sortChildren.ts` — child sorting behavior and hot-path comparator logic.
- `packages/trees/scripts/benchmarkFileListToTree.ts` — benchmark harness (only if extra diagnostics are needed).
- `autoresearch.sh` — benchmark orchestration and metric extraction.
- `autoresearch.checks.sh` — fast correctness checks for each passing experiment.

## Off Limits
- Public API shape and exported types outside the tree-building internals.
- Benchmark fixtures/data files.
- Unrelated packages/apps in the monorepo.

## Constraints
- Preserve benchmark checksum behavior.
- Keep file tree ordering semantics intact.
- Fast correctness checks must pass (`fileListToTree` + drag-and-drop tests).
- No new dependencies.

## What's Been Tried
- Session initialized; baseline pending.
