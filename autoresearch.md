# Autoresearch: path-store presorted first render

## Objective

Optimize the real `@pierre/path-store` presorted 0→1 render path represented by:

- `bun ws path-store benchmark -- --preset presorted-render`

The benchmark preset currently measures two component scenarios against the
`linux-5x` workload:

- `build/linux-5x`
- `visible-first/linux-5x/30`

and the main optimization target is the derived summary that sums those two
measured components:

- `equivalent-presorted-warm-first-render/linux-5x/30`

This is the best primary metric because it matches the intended workload: start
from a presorted path array, build the store, and render the first visible 30
rows.

The nearby truth-check is:

- `bun ws path-store profile:demo -- --runs 5`

That command profiles the same rough flow in the browser and exposes phase
timings. Use it whenever a benchmark win looks suspiciously large or when code
changes might have moved work outside the benchmark boundary. If benchmark
numbers improve dramatically but `profile:demo` does not, treat that as a likely
measurement mistake until proven otherwise.

## Metrics

- **Primary**: `presorted_first_render_p50_ms` (ms, lower is better) — p50 of
  `equivalent-presorted-warm-first-render/linux-5x/30`
- **Secondary**:
  - `presorted_first_render_p95_ms`
  - `build_p50_ms`
  - `build_p95_ms`
  - `visible_first_p50_ms`
  - `visible_first_p95_ms`
  - optional truth-check metrics when `AUTORESEARCH_PROFILE_DEMO=1`:
    - `profile_visible_rows_ready_median_ms`
    - `profile_visible_rows_ready_p95_ms`
    - `profile_post_paint_ready_median_ms`
    - `profile_post_paint_ready_p95_ms`
  - optional mutation guardrail metrics when `AUTORESEARCH_MUTATION_GUARD=1`:
    - `rename_leaf_p50_ms`
    - `rename_leaf_p95_ms`
    - `rename_root_directory_p50_ms`
    - `rename_root_directory_p95_ms`

Mutation metrics are a **soft monitor**, not a hard gate. The goal is to avoid
accidental regressions where first-render wins are purchased by turning
interactive mutations from sub-millisecond into tens or hundreds of
milliseconds.

## How to Run

Primary loop command:

```bash
./autoresearch.sh
```

Optional truth-check / guardrail modes:

```bash
AUTORESEARCH_PROFILE_DEMO=1 ./autoresearch.sh
AUTORESEARCH_MUTATION_GUARD=1 ./autoresearch.sh
AUTORESEARCH_PROFILE_DEMO=1 AUTORESEARCH_MUTATION_GUARD=1 ./autoresearch.sh
```

Correctness checks run through:

```bash
./autoresearch.checks.sh
```

## Files in Scope

- `packages/path-store/src/store.ts` — constructor path, public read APIs, and
  benchmark instrumentation boundaries
- `packages/path-store/src/builder.ts` — presorted ingest builder hot path
- `packages/path-store/src/canonical.ts` — canonical topology mutations, path
  materialization, count repair
- `packages/path-store/src/projection.ts` — visible count and first-window
  selection/materialization
- `packages/path-store/src/child-index.ts` — child visible-count lookup for cold
  visible selection
- `packages/path-store/src/flatten.ts` — flatten-empty-directory projection
  logic used by first rows
- `packages/path-store/src/state.ts` — expansion state and cache invalidation
  bookkeeping
- `packages/path-store/src/cleanup.ts` — cleanup behavior if memory/cache work
  touches first-render tradeoffs
- `packages/path-store/src/static-store.ts` — useful reference if a mutable-path
  optimization can borrow a read-side idea
- `packages/path-store/src/internal/benchmarkInstrumentation.ts` —
  instrumentation hooks surfaced by `profile:demo`
- `packages/path-store/scripts/benchmark.ts` — benchmark preset wiring and
  derived summary reporting; instrumentation changes are allowed, measurement
  narrowing is not
- `packages/path-store/scripts/profileDemo.ts` — browser profiling harness for
  hotspot inspection and truth-checking
- `packages/path-store/test/**` — correctness coverage and benchmark-script
  tests

## Off Limits

- Any change whose main effect is to measure less work instead of making the
  real workload faster
- Ingesting fewer paths, rendering fewer real rows, or otherwise shrinking the
  workload while still claiming the same benchmark win
- Changing `presorted-render` or `profile:demo` semantics in a way that hides
  work outside the measured section
- Repo-wide dependency changes unless absolutely necessary (they should not be
  necessary here)

## Constraints

- Keep wins grounded in real user-facing performance, not benchmark tricks
- Use `profile:demo` to validate suspiciously large benchmark improvements
- Lint, typecheck, and `packages/path-store` tests must pass before keeping a
  result
- Use `bun`, not `npm`/`pnpm`
- Prefer localized hot-path improvements over broad architectural churn unless
  profiling clearly justifies larger changes
- Internal behavior changes are allowed; external behavior changes are allowed
  only when justified and still aligned with the workload goal

## What's Been Tried

- Baseline setup completed on branch `autoresearch/path-store-presorted-render-2026-04-06`.
- Baseline benchmark via `./autoresearch.sh`:
  - `build/linux-5x` p50 = `501.940 ms`, p95 = `506.895 ms`
  - `visible-first/linux-5x/30` p50 = `0.001459 ms`, p95 = `0.002250 ms`
  - `equivalent-presorted-warm-first-render/linux-5x/30` p50 = `501.942 ms`, p95 = `506.897 ms`
- Baseline checks passed:
  - `bun run lint`
  - `cd packages/path-store && bun run tsc`
  - `cd packages/path-store && bun test`
- Early read-through notes:
  - The first-render target is overwhelmingly dominated by build time, not the
    visible-window read itself.
  - The builder plus initial count recomputation are the likely primary hot
    path; `visible-first` itself is already effectively free compared with
    build.
  - Use `profile:demo` to confirm whether future wins are real improvements to
    store creation/count repair rather than work moving outside the benchmarked
    region.
