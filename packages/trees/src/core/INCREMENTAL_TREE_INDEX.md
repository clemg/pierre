# Incremental tree index design (v1)

The tree core now maintains an **incremental internal index** instead of fully
rebuilding flattened metadata from a DFS traversal on every `rebuildTree()`.

## Invariants

- `nodes: Map<id, InternalTreeNode>` is the canonical node store.
  - Every known node tracks `id`, `parentId`, `children`, `level`, `expanded`,
    `orderKey`, `posInSet`, `setSize`, and child load state.
- Visible order is stored explicitly in a block-based ordered index.
- `visibleMetaById` stores ARIA-related metadata for visible nodes: `parentId`,
  `level`, `posInSet`, `setSize`.
- `visible` + `visibleMetaById` are always updated together.
- Unknown or non-visible items fall back to a safe `ItemMeta` sentinel
  (`index: -1`, `level: -1`, etc.).

## Ordered-index choice

### Lock-in snapshot (current branch shape)

The current mutation-fast shape we are converging on is:

- **Model graph is ID/parent-pointer first** (`FileTreeModel` +
  `MutablePathTree`)
  - stable IDs are decoupled from path strings,
  - path lookups are projection helpers (`pathToId` / `idToPath`),
  - path-tree mutations (`add/delete/move/rename`) rewire pointers locally.
- **Core visible order is index-first** (`IncrementalTreeIndex`)
  - `nodes` keeps structural metadata,
  - `visible` (`VisibleBlockIndex`) is the mutable ordered visible sequence,
  - `visibleMetaById` keeps per-visible-node ARIA/index metadata.
- **Mutation notifications are changesets**
  - runtime marks only affected parents dirty,
  - rebuild performs branch-local refreshes instead of full traversal.

Important implementation detail we now rely on for large subtree moves:

- Visible block insertion avoids argument-spread splice (`splice(...ids)`) for
  large fragments, because JS argument limits can trigger stack overflows. We
  build a merged block array (`head + inserted + tail`) and then split.

This keeps root-structural edits incremental and avoids fallback-to-full rebuild
on very large insert fragments.

v1 uses a **chunked block index** (`VisibleBlockIndex`) instead of a flat array:

- IDs are stored in fixed-size blocks (default 128 IDs per block).
- Local inserts/removes mutate one/few blocks, then recompute block starts.
- `itemId -> { block, offset }` locations provide O(1)-ish index lookups.
- Prefix starts are maintained per block, avoiding per-mutation O(N) array
  shifting for the whole visible list.

This gives B+-tree-like locality and mutation behavior with simpler JS/TS
implementation complexity.

## Key scheme

Sibling order is explicit via a gap-based `orderKey` per child
(`(index + 1) * ORDER_KEY_GAP` in v1).

- Order is no longer derived from traversal as source-of-truth.
- Reindexing is limited to the affected sibling list (branch-local), never a
  global renumber across the full tree.
- This leaves a clear seam for denser fractional-key strategies later if needed.

## Incremental operations in v1

Fully incremental / branch-local in v1:

- Expand / collapse (visible range insert/remove under the toggled node)
- Branch child updates via `markBranchDirty(..., 'children')`
  - insert leaf/folder
  - delete leaf/subtree
  - sibling reorder
  - move subtree (when source/target parents are marked dirty)
- Metadata-only updates can skip structural rebuild (`setState` re-render path)

`rebuildTree()` now performs:

1. expansion diff (collapse/remove then expand/insert),
2. dirty-branch refreshes,
3. no-op when neither structure nor visibility changed.

## Partial recompute paths retained

- `rebuildTreeFromScratch()` is retained as a recovery/benchmark hook.
- Data-loader identity changes currently force a full rebuild in v1.
  - This is correctness-first and keeps stale-cache risk low.
  - Future optimization: loader-aware structural diffing for immutable loader
    replacement workflows.

## Async-ready branch states

Nodes track child load state (`unknown | loading | loaded | invalidated`).
`markBranchDirty(id, 'invalidated')` is supported so async child invalidation
can refresh just the affected branch once data arrives.

## Future optimization targets

1. Data-loader replacement diffing (avoid forced full rebuilds on immutable
   loader swaps with small structural deltas).
2. Richer order-key insertion strategy (fractional keys without sibling
   reindexing).
3. Optional subtree size / descendant caches for even faster range operations.
4. More aggressive dirty-root coalescing for complex batch moves.

## v2 model direction (in progress)

The next major step is to make the canonical model fully **ID/parent-pointer
first**, while keeping path-based APIs as a projection layer.

Planned properties:

- Node identity is stable and path-independent.
- After the initial model build, common edits (`add`, `delete`, `rename`,
  `move`) should update local node links/child lists instead of rebuilding a
  full file snapshot.
- External mutation notifications should be **changesets**, not mandatory full
  `files[]` snapshots.

### SSR-stable IDs

Initial IDs should be deterministic from server input so SSR hydration can match
model identities. Path-derived hashing is acceptable as the bootstrap key
source, while post-hydration mutations keep IDs stable even if paths change.

### Why we are not introducing ropes/B+ trees yet

The current block index already provides good locality with simpler
implementation costs. A rope/B+ visible-order structure is a follow-on step for
very large range edits (especially root-level subtree moves), once the model
layer is fully local-mutation-first.

Expected follow-on benefits when introduced:

- lower-cost giant visible-range splices,
- better asymptotic behavior for very large trees,
- improved worst-case root-level structural edits.
