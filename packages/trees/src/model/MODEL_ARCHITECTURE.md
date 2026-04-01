# File Tree Model Architecture (Mutation-First)

This document describes the internal data-structure shape we converged on for
large-tree mutation performance.

The goal is to give a new agent enough detail to recreate the approach from
scratch, even if APIs change.

---

## 1) Optimization target

Primary target:

- Keep **localized mutations** cheap (`rename`, `add`, `delete`, `move`) in very
  large trees.

Secondary target:

- Keep root-structural edits (`move-root-folder`, `delete-root-folder`) stable
  and incremental (no hangs, no fallback full rebuilds in normal paths).

Non-goal during this phase:

- Initial render speed (important, but explicitly deprioritized relative to
  mutation latency).

---

## 2) Architectural shape (3 layers)

We use three cooperating structures:

1. **Canonical model graph (ID-first)**
2. **Mutable path mutation engine (parent-pointer path tree)**
3. **Incremental visible-order index (block index)**

This separation is deliberate:

- the model handles semantic correctness and stable identity,
- the path tree handles path-native mutation mechanics cheaply,
- the visible index handles UI-visible order/meta updates incrementally.

---

## 3) Canonical model graph (ID-first)

Core stores:

- `tree: Map<id, node>`
- `pathToIdMap: Map<path, id>`
- `idToPathMap: Map<id, path>`

Typical node shape:

```ts
type Node = {
  name: string;
  path: string; // canonical path projection
  children?: {
    direct: string[]; // child IDs
    flattened?: string[]; // child IDs in flatten projection
  };
  flattens?: string[]; // IDs of folders represented by a flattened node
};
```

### Why this shape

- Stable IDs decouple identity from path churn.
- Path API remains user-facing while internals remain ID-first.
- Enables local rewiring instead of global rebuilds for most edits.

### Key design detail: deterministic bootstrap IDs

Initial IDs are deterministic from path hash (`p_<hash>` + collision suffix) so
SSR/hydration stays stable.

---

## 4) Path mutation engine: parent-pointer tree

`MutablePathTree` is a mutable filesystem trie with parent pointers.

### Node shape

- Folder nodes: `children: Map<segment, node>`
- File nodes:
  - parent pointer + name
  - linked-list pointers (`previous`, `next`)
  - stable insertion token (`order`)

### Why

- Folder move/rename is pointer rewiring, not descendant path rewriting.
- `files[]` snapshot can be rebuilt lazily from file linked list.
- Preserves insertion order naturally without array-wide shifts.

### Tradeoff

- Path strings become derived state.
- Requires careful invalidation/materialization boundaries.

---

## 5) Deferred path remap overlay

Folder rename/move is often handled by queuing prefix remaps instead of eagerly
rewriting every descendant path.

Core mechanism:

- `pendingPathPrefixRemaps: [{ sourcePath, destinationPath }]`
- `id -> path`: apply remaps **forward**
- `path -> id`: map path **backward** to canonical path, then verify round-trip

Related snapshot optimization:

- `pendingFileSnapshotPrefixRemaps` lets us defer expensive `files[]` rewrite
  until snapshot access is requested.

### Why

- Keeps hot mutation path cheap for large subtree renames/moves.

### Hard part

- Correctness under overlapping remaps and mixed lookup directions.

---

## 6) Local folder rebuild strategy

After mutation, we rebuild only affected folders (plus minimal propagated
ancestors), not the full model.

Key helper concept:

- `rebuildFolderNodesFromPathTree(affectedFolderPaths)`

What it does:

- Reuses previous child arrays when still valid.
- Recomputes direct children only when needed.
- Rebuilds flatten projections only where necessary.
- Tracks flattened node lifecycle via ref-count (`increment/decrement`).
- Propagates parent rebuild only when child shape changes imply parent flatten
  semantics may have changed.

Auxiliary cache:

- `directChildIndexByFolderId` avoids repeated linear scans for child index
  lookups during patching.

---

## 7) Mutation protocol (changesets, not snapshots)

Mutations emit semantic changesets:

- `rename-path`
- `move-paths`
- `add-paths`
- `delete-paths`

Each includes `affectedParentIds` (or equivalent localized invalidation
payload).

Runtime/view layer consumes this and marks only those branches dirty.

### Why

- This is incremental view maintenance: mutate model once, update only impacted
  view branches.

### Tradeoff

- If invalidation sets are incomplete, stale UI/meta bugs can occur.

---

## 8) Incremental visible-order index (UI side)

The model is not the visible list.
Visible order is maintained by an incremental index.

Core pieces:

- `nodes: Map<id, InternalTreeNode>` with parent/level/expanded metadata
- `visibleMetaById: Map<id, { parentId, level, posInSet, setSize }>`
- `visible: VisibleBlockIndex`

`VisibleBlockIndex` stores IDs in chunks (block size ~128) and supports local
insert/remove with per-ID location map.

This is similar to an unrolled list / B+-tree leaf layer specialized for
visible preorder mutation.

### Critical implementation lesson

For large inserts, avoid `splice(offset, 0, ...largeArray)`.
Use block merge (`head + inserted + tail`) to avoid JS argument-stack limits.

That single detail prevented stack overflows and full-rebuild fallback during
large root-folder moves.

---

## 9) Root-specific fast path

Root structural changes are common and expensive in huge fixtures.

We use a root-child diff path to avoid always rebuilding the whole visible
sequence:

- detect changed middle segment via prefix/suffix match,
- remove only affected root-visible subtrees,
- insert only affected root-visible fragment,
- repair root child visible metadata.

Guardrails ensure we only remove nodes still attached as root children
(`parentId === root` + `level === 0`).

---

## 10) Tensions and hard problems

### A) ID-first internals vs path-first UX

Users express mutations in paths; internals want stable IDs.
Maintaining both with deferred remaps is inherently complex.

### B) Flattening semantics

Flattened folder nodes are synthetic and topology-dependent.
Small local edits can cause broad flatten identity/projection churn.

### C) Root structural operations

Even with good structure, moving a huge expanded subtree is still expensive
because visible preorder truly changes a lot.

### D) Collision + batch move semantics

Multi-source move planning must handle:

- source/destination overlaps,
- destination collisions,
- nested folder selections,
- deterministic ordering.

### E) Lazy/deferred state complexity

Deferral improves performance but multiplies invalidation edges:

- remap chains,
- snapshot materialization,
- cache reuse boundaries.

---

## 11) How this maps to known structures

We are effectively combining:

- **Filesystem trie** (path segments) + parent-pointer rewiring
- **Bi-map projection layer** (`path <-> id`) with deferred transforms
- **Unrolled sequence blocks** for mutable visible order
- **Incremental view maintenance** via explicit mutation changesets

Differences from textbook forms:

- flatten projection (`flattened`, `flattens`) is domain-specific,
- path remap overlay is a practical optimization layer over the canonical graph,
- root-visible branch diffing is specialized for UI-tree workloads.

---

## 12) Where theoretical gains remain

1. **Order-statistic tree / rope / B+ tree** for visible sequence
   - Better worst-case root-range splices.
2. **Subtree visible counts / interval indexing**
   - Faster subtree boundary calculations.
3. **Prefix-remap compaction** (e.g. trie/transducer)
   - Lower lookup cost under long remap chains.
4. **Explicit mutation transactions**
   - Batch invalidation/materialization once per logical action.
5. **Stronger invariant checks in debug mode**
   - Catch subtle stale-state bugs earlier.

---

## 13) Rebuild-from-scratch recipe

If implementing a standalone model library with this shape:

1. Build deterministic stable IDs and canonical `tree + path/id` maps.
2. Add parent-pointer mutable path tree for mutation mechanics.
3. Add deferred path-prefix remap overlay (forward/backward resolution).
4. Implement local folder rebuild + flatten projection lifecycle/ref-count.
5. Emit mutation changesets with affected parent IDs.
6. Maintain a separate incremental visible-order structure (block index).
7. Add root-specialized structural diff path.
8. Add stress tests for root moves, flatten churn, collision handling, and
   no-fallback incremental behavior.

This gives the same mutation-first complexity profile we optimized for in this
branch.
