- Lazy visible-item materialization: keep `rebuildTree()` responsible for
  computing visible item metadata / ID order, but defer full item-instance
  creation until `getItemInstance()` or `getItems()` actually needs it. Pair
  this with `Root.tsx` / benchmark runtime rendering from cached visible item
  IDs instead of `tree.getItems()`. First prototype roughly halved
  `construct_and_render_ms` (~120.3ms -> ~57.6ms) but failed
  `packages/trees/test/core/core.test.ts` because those tests currently expect
  `instanceBuilder` calls during `rebuildTree()` and expanded-state config
  changes. Follow-up options: (1) decide whether that eager-instance behavior is
  a required internal contract and update tests if not, or (2) preserve the
  contract by eagerly materializing only enough instances to satisfy
  builder-side effects while still avoiding full `tree.getItems()` arrays in the
  virtualized render path.
- fileListToTree child-array reuse with copy-on-write: the unsorted `sort:false`
  workload likely still spends time converting the same `folderChildren` Sets
  into arrays for flattening and folder-node creation. A direct array-sharing
  prototype crashed because `hashTreeKeys()` mutates `children.direct` in place,
  so shared arrays were rewritten to hashed IDs too early. A safer follow-up
  would keep the cached arrays immutable and only copy at the final
  node-ownership boundaries, or make `hashTreeKeys()` explicitly tolerate
  already-hashed child IDs without hiding real missing-key bugs.
