import { createTree } from '../src/core/create-tree';
import type { TreeInstance } from '../src/core/types/core';
import { syncDataLoaderFeature } from '../src/features/sync-data-loader/feature';
import {
  formatMs,
  getEnvironment,
  parseNonNegativeInteger,
  parsePositiveInteger,
  printTable,
  summarizeSamples,
  type TimingSummary,
} from './lib/benchmarkUtils';

type RebuildMode = 'incremental' | 'full';

interface BenchmarkItem {
  id: string;
  name: string;
  isFolder: boolean;
}

interface FixtureBlueprint {
  items: Record<string, BenchmarkItem>;
  children: Record<string, string[]>;
  folderIdsByDepth: string[][];
  leafIds: string[];
  expandedItems: string[];
}

interface MutableFixtureState {
  items: Map<string, BenchmarkItem>;
  children: Map<string, string[]>;
}

interface BenchmarkTargets {
  renameItemId: string;
  insertParentId: string;
  deleteParentId: string;
  deleteSubtreeId: string;
  expandCollapseId: string;
  moveSourceParentId: string;
  moveTargetParentId: string;
  moveSubtreeId: string;
}

interface ScenarioSummary {
  operation: string;
  incremental: TimingSummary;
  full: TimingSummary;
}

interface BenchmarkConfig {
  runs: number;
  warmupRuns: number;
  outputJson: boolean;
  branching: number;
  depth: number;
  filesPerFolder: number;
}

interface BenchmarkOutput {
  benchmark: 'incrementalTreeIndex';
  environment: ReturnType<typeof getEnvironment>;
  config: BenchmarkConfig;
  summaries: Array<{
    operation: string;
    incremental: TimingSummary;
    full: TimingSummary;
    speedupMedianX: number;
  }>;
}

const DEFAULT_CONFIG: BenchmarkConfig = {
  runs: 60,
  warmupRuns: 8,
  outputJson: false,
  branching: 8,
  depth: 5,
  filesPerFolder: 2,
};

function printHelpAndExit(): never {
  console.log('Usage: bun ws trees benchmark:incremental-index -- [options]');
  console.log('');
  console.log('Options:');
  console.log(
    '  --runs <number>            Measured runs per operation (default: 60)'
  );
  console.log(
    '  --warmup-runs <number>     Warmup runs per operation (default: 8)'
  );
  console.log(
    '  --branching <number>       Folder branching factor (default: 8)'
  );
  console.log('  --depth <number>           Folder depth (default: 5)');
  console.log(
    '  --files-per-folder <num>   Leaf files per folder (default: 2)'
  );
  console.log('  --json                     Emit machine-readable JSON output');
  console.log('  -h, --help                 Show this help output');
  process.exit(0);
}

function parseArgs(argv: string[]): BenchmarkConfig {
  const config: BenchmarkConfig = { ...DEFAULT_CONFIG };

  for (let index = 0; index < argv.length; index++) {
    const rawArg = argv[index];

    if (rawArg === '--help' || rawArg === '-h') {
      printHelpAndExit();
    }

    if (rawArg === '--json') {
      config.outputJson = true;
      continue;
    }

    const [flag, inlineValue] = rawArg.split('=', 2);
    if (
      flag !== '--runs' &&
      flag !== '--warmup-runs' &&
      flag !== '--branching' &&
      flag !== '--depth' &&
      flag !== '--files-per-folder'
    ) {
      throw new Error(`Unknown argument: ${rawArg}`);
    }

    const value = inlineValue ?? argv[index + 1];
    if (value == null) {
      throw new Error(`Missing value for ${flag}`);
    }

    if (inlineValue == null) {
      index += 1;
    }

    if (flag === '--runs') {
      config.runs = parsePositiveInteger(value, '--runs');
    } else if (flag === '--warmup-runs') {
      config.warmupRuns = parseNonNegativeInteger(value, '--warmup-runs');
    } else if (flag === '--branching') {
      config.branching = parsePositiveInteger(value, '--branching');
    } else if (flag === '--depth') {
      config.depth = parsePositiveInteger(value, '--depth');
    } else {
      config.filesPerFolder = parseNonNegativeInteger(
        value,
        '--files-per-folder'
      );
    }
  }

  return config;
}

function createFixtureBlueprint(
  branching: number,
  depth: number,
  filesPerFolder: number
): FixtureBlueprint {
  const items: Record<string, BenchmarkItem> = {
    root: { id: 'root', name: 'root', isFolder: true },
  };
  const children: Record<string, string[]> = {
    root: [],
  };
  const folderIdsByDepth: string[][] = [];
  const leafIds: string[] = [];

  const buildFolder = (parentId: string, currentDepth: number) => {
    if (currentDepth >= depth) {
      return;
    }

    const nextChildren: string[] = [];

    for (let folderIndex = 0; folderIndex < branching; folderIndex++) {
      const folderId =
        parentId === 'root'
          ? `dir-${currentDepth}-${folderIndex}`
          : `${parentId}/dir-${currentDepth}-${folderIndex}`;
      items[folderId] = {
        id: folderId,
        name: folderId.slice(folderId.lastIndexOf('/') + 1),
        isFolder: true,
      };
      children[folderId] = [];
      folderIdsByDepth[currentDepth] ??= [];
      folderIdsByDepth[currentDepth].push(folderId);
      nextChildren.push(folderId);

      buildFolder(folderId, currentDepth + 1);
    }

    for (let fileIndex = 0; fileIndex < filesPerFolder; fileIndex++) {
      const fileId =
        parentId === 'root'
          ? `file-${currentDepth}-${fileIndex}.txt`
          : `${parentId}/file-${currentDepth}-${fileIndex}.txt`;
      items[fileId] = {
        id: fileId,
        name: fileId.slice(fileId.lastIndexOf('/') + 1),
        isFolder: false,
      };
      leafIds.push(fileId);
      nextChildren.push(fileId);
    }

    children[parentId] = nextChildren;
  };

  buildFolder('root', 0);

  const expandedItems = folderIdsByDepth.flat();

  return {
    items,
    children,
    folderIdsByDepth,
    leafIds,
    expandedItems,
  };
}

function cloneFixtureState(blueprint: FixtureBlueprint): MutableFixtureState {
  const items = new Map<string, BenchmarkItem>();
  const children = new Map<string, string[]>();

  for (const [itemId, item] of Object.entries(blueprint.items)) {
    items.set(itemId, { ...item });
  }

  for (const [parentId, childIds] of Object.entries(blueprint.children)) {
    children.set(parentId, [...childIds]);
  }

  return { items, children };
}

function createBenchmarkTree(
  fixture: MutableFixtureState,
  expandedItems: readonly string[],
  initialize = true
): TreeInstance<BenchmarkItem> {
  const tree = createTree<BenchmarkItem>({
    rootItemId: 'root',
    dataLoader: {
      getItem: (id) =>
        fixture.items.get(id) ?? {
          id,
          name: id,
          isFolder: false,
        },
      getChildren: (id) => fixture.children.get(id) ?? [],
    },
    getItemName: (item) => item.getItemData().name,
    isItemFolder: (item) => item.getItemData().isFolder,
    features: [syncDataLoaderFeature],
    initialState: {
      expandedItems: [...expandedItems],
    },
  });

  tree.setMounted(true);
  if (initialize) {
    tree.rebuildTree();
  }

  return tree;
}

function resolveTargets(blueprint: FixtureBlueprint): BenchmarkTargets {
  const getFolder = (depth: number, index: number): string => {
    const foldersAtDepth = blueprint.folderIdsByDepth[depth] ?? [];
    const folderId = foldersAtDepth[index] ?? foldersAtDepth[0];
    if (folderId == null) {
      throw new Error(`Unable to resolve folder at depth ${depth}`);
    }
    return folderId;
  };

  const pickFolderChild = (
    parentId: string,
    exclude: Set<string> = new Set()
  ) => {
    const childIds = blueprint.children[parentId] ?? [];
    for (let index = 0; index < childIds.length; index++) {
      const childId = childIds[index];
      if (exclude.has(childId)) {
        continue;
      }
      if (blueprint.items[childId]?.isFolder === true) {
        return childId;
      }
    }
    return null;
  };

  const renameItemId =
    blueprint.leafIds[Math.floor(blueprint.leafIds.length / 2)];
  const insertParentId = getFolder(
    Math.min(2, blueprint.folderIdsByDepth.length - 1),
    0
  );

  const deleteParentId = getFolder(
    Math.min(1, blueprint.folderIdsByDepth.length - 1),
    0
  );
  const deleteSubtreeId = pickFolderChild(deleteParentId);
  if (deleteSubtreeId == null) {
    throw new Error(`Unable to find subtree candidate under ${deleteParentId}`);
  }

  const expandCollapseId = getFolder(
    Math.min(1, blueprint.folderIdsByDepth.length - 1),
    1
  );

  const moveSourceParentId = getFolder(
    Math.min(1, blueprint.folderIdsByDepth.length - 1),
    2
  );
  const moveTargetParentId = getFolder(
    Math.min(1, blueprint.folderIdsByDepth.length - 1),
    3
  );
  const moveSubtreeId = pickFolderChild(
    moveSourceParentId,
    new Set<string>([moveTargetParentId])
  );
  if (moveSubtreeId == null) {
    throw new Error(
      `Unable to find movable subtree under ${moveSourceParentId}`
    );
  }

  return {
    renameItemId,
    insertParentId,
    deleteParentId,
    deleteSubtreeId,
    expandCollapseId,
    moveSourceParentId,
    moveTargetParentId,
    moveSubtreeId,
  };
}

function createRebuildHelpers(
  tree: TreeInstance<BenchmarkItem>,
  mode: RebuildMode
): {
  markDirty: (itemId: string) => void;
  rebuild: () => void;
  timeRebuild: () => number;
} {
  const rebuild = () => {
    if (mode === 'full') {
      tree.rebuildTreeFromScratch();
      return;
    }
    tree.rebuildTree();
  };

  const markDirty = (itemId: string) => {
    if (mode === 'incremental') {
      tree.markBranchDirty(itemId, 'children');
    }
  };

  const timeRebuild = () => {
    const start = performance.now();
    rebuild();
    return performance.now() - start;
  };

  return {
    markDirty,
    rebuild,
    timeRebuild,
  };
}

function measureScenario(
  runs: number,
  warmupRuns: number,
  createSample: () => number
): TimingSummary {
  const samples: number[] = [];

  for (let warmupIndex = 0; warmupIndex < warmupRuns; warmupIndex++) {
    createSample();
  }

  for (let runIndex = 0; runIndex < runs; runIndex++) {
    samples.push(createSample());
  }

  return summarizeSamples(samples);
}

function benchmarkInitialIngest(
  blueprint: FixtureBlueprint,
  mode: RebuildMode
): () => number {
  return () => {
    const fixture = cloneFixtureState(blueprint);
    const start = performance.now();
    const tree = createBenchmarkTree(fixture, blueprint.expandedItems, false);

    if (mode === 'full') {
      tree.rebuildTreeFromScratch();
    } else {
      tree.rebuildTree();
    }

    return performance.now() - start;
  };
}

function benchmarkRenameSingleItem(
  blueprint: FixtureBlueprint,
  targets: BenchmarkTargets,
  mode: RebuildMode
): () => number {
  const fixture = cloneFixtureState(blueprint);
  const tree = createBenchmarkTree(fixture, blueprint.expandedItems);
  const item = fixture.items.get(targets.renameItemId);

  if (item == null) {
    throw new Error(`Missing rename target ${targets.renameItemId}`);
  }

  const { rebuild, timeRebuild } = createRebuildHelpers(tree, mode);
  const baseName = item.name;
  let sampleIndex = 0;

  return () => {
    item.name = `${baseName}-renamed-${sampleIndex}`;
    sampleIndex += 1;

    const durationMs = timeRebuild();

    item.name = baseName;
    rebuild();

    return durationMs;
  };
}

function benchmarkInsertLeaf(
  blueprint: FixtureBlueprint,
  targets: BenchmarkTargets,
  mode: RebuildMode
): () => number {
  const fixture = cloneFixtureState(blueprint);
  const tree = createBenchmarkTree(fixture, blueprint.expandedItems);
  const { markDirty, rebuild, timeRebuild } = createRebuildHelpers(tree, mode);

  const insertedLeafId = `${targets.insertParentId}/__bench-inserted-leaf`;
  fixture.items.set(insertedLeafId, {
    id: insertedLeafId,
    name: '__bench-inserted-leaf',
    isFolder: false,
  });

  return () => {
    const parentChildren = fixture.children.get(targets.insertParentId);
    if (parentChildren == null) {
      throw new Error(`Missing insert parent ${targets.insertParentId}`);
    }

    const insertionIndex = Math.floor(parentChildren.length / 2);
    parentChildren.splice(insertionIndex, 0, insertedLeafId);
    markDirty(targets.insertParentId);

    const durationMs = timeRebuild();

    const insertedIndex = parentChildren.indexOf(insertedLeafId);
    parentChildren.splice(insertedIndex, 1);
    markDirty(targets.insertParentId);
    rebuild();

    return durationMs;
  };
}

function benchmarkDeleteSubtree(
  blueprint: FixtureBlueprint,
  targets: BenchmarkTargets,
  mode: RebuildMode
): () => number {
  const fixture = cloneFixtureState(blueprint);
  const tree = createBenchmarkTree(fixture, blueprint.expandedItems);
  const { markDirty, rebuild, timeRebuild } = createRebuildHelpers(tree, mode);

  return () => {
    const parentChildren = fixture.children.get(targets.deleteParentId);
    if (parentChildren == null) {
      throw new Error(`Missing delete parent ${targets.deleteParentId}`);
    }

    const originalIndex = parentChildren.indexOf(targets.deleteSubtreeId);
    if (originalIndex < 0) {
      throw new Error(
        `Subtree ${targets.deleteSubtreeId} is not under ${targets.deleteParentId}`
      );
    }

    parentChildren.splice(originalIndex, 1);
    markDirty(targets.deleteParentId);

    const durationMs = timeRebuild();

    parentChildren.splice(originalIndex, 0, targets.deleteSubtreeId);
    markDirty(targets.deleteParentId);
    rebuild();

    return durationMs;
  };
}

function benchmarkExpandCollapse(
  blueprint: FixtureBlueprint,
  targets: BenchmarkTargets,
  mode: RebuildMode
): () => number {
  const fixture = cloneFixtureState(blueprint);
  const tree = createBenchmarkTree(fixture, blueprint.expandedItems);
  const { timeRebuild } = createRebuildHelpers(tree, mode);

  return () => {
    tree.applySubStateUpdate('expandedItems', (expandedItems) =>
      expandedItems.filter((itemId) => itemId !== targets.expandCollapseId)
    );
    const collapseDurationMs = timeRebuild();

    tree.applySubStateUpdate('expandedItems', (expandedItems) => [
      ...expandedItems,
      targets.expandCollapseId,
    ]);
    const expandDurationMs = timeRebuild();

    return (collapseDurationMs + expandDurationMs) / 2;
  };
}

function benchmarkMoveSubtree(
  blueprint: FixtureBlueprint,
  targets: BenchmarkTargets,
  mode: RebuildMode
): () => number {
  const fixture = cloneFixtureState(blueprint);
  const tree = createBenchmarkTree(fixture, blueprint.expandedItems);
  const { markDirty, rebuild, timeRebuild } = createRebuildHelpers(tree, mode);

  return () => {
    const sourceChildren = fixture.children.get(targets.moveSourceParentId);
    const targetChildren = fixture.children.get(targets.moveTargetParentId);

    if (sourceChildren == null || targetChildren == null) {
      throw new Error('Unable to resolve move parent children arrays.');
    }

    const sourceIndex = sourceChildren.indexOf(targets.moveSubtreeId);
    if (sourceIndex < 0) {
      throw new Error(
        `Move subtree ${targets.moveSubtreeId} is not under ${targets.moveSourceParentId}`
      );
    }

    sourceChildren.splice(sourceIndex, 1);
    const targetInsertionIndex = Math.floor(targetChildren.length / 2);
    targetChildren.splice(targetInsertionIndex, 0, targets.moveSubtreeId);

    markDirty(targets.moveSourceParentId);
    markDirty(targets.moveTargetParentId);
    const durationMs = timeRebuild();

    const movedIndexInTarget = targetChildren.indexOf(targets.moveSubtreeId);
    targetChildren.splice(movedIndexInTarget, 1);
    sourceChildren.splice(sourceIndex, 0, targets.moveSubtreeId);

    markDirty(targets.moveSourceParentId);
    markDirty(targets.moveTargetParentId);
    rebuild();

    return durationMs;
  };
}

function runBenchmark(config: BenchmarkConfig): ScenarioSummary[] {
  const blueprint = createFixtureBlueprint(
    config.branching,
    config.depth,
    config.filesPerFolder
  );
  const targets = resolveTargets(blueprint);

  const scenarios: Array<{
    operation: string;
    createSample: (mode: RebuildMode) => () => number;
  }> = [
    {
      operation: 'initial-ingest',
      createSample: (mode) => benchmarkInitialIngest(blueprint, mode),
    },
    {
      operation: 'rename-single-item',
      createSample: (mode) =>
        benchmarkRenameSingleItem(blueprint, targets, mode),
    },
    {
      operation: 'insert-leaf',
      createSample: (mode) => benchmarkInsertLeaf(blueprint, targets, mode),
    },
    {
      operation: 'delete-subtree',
      createSample: (mode) => benchmarkDeleteSubtree(blueprint, targets, mode),
    },
    {
      operation: 'expand-collapse-medium-subtree',
      createSample: (mode) => benchmarkExpandCollapse(blueprint, targets, mode),
    },
    {
      operation: 'move-subtree',
      createSample: (mode) => benchmarkMoveSubtree(blueprint, targets, mode),
    },
  ];

  const summaries: ScenarioSummary[] = [];

  for (
    let scenarioIndex = 0;
    scenarioIndex < scenarios.length;
    scenarioIndex++
  ) {
    const scenario = scenarios[scenarioIndex];

    const incrementalSummary = measureScenario(
      config.runs,
      config.warmupRuns,
      scenario.createSample('incremental')
    );

    const fullSummary = measureScenario(
      config.runs,
      config.warmupRuns,
      scenario.createSample('full')
    );

    summaries.push({
      operation: scenario.operation,
      incremental: incrementalSummary,
      full: fullSummary,
    });
  }

  return summaries;
}

function main() {
  const config = parseArgs(process.argv.slice(2));
  const environment = getEnvironment();
  const summaries = runBenchmark(config);

  if (config.outputJson) {
    const output: BenchmarkOutput = {
      benchmark: 'incrementalTreeIndex',
      environment,
      config,
      summaries: summaries.map((summary) => ({
        operation: summary.operation,
        incremental: summary.incremental,
        full: summary.full,
        speedupMedianX:
          summary.incremental.medianMs === 0
            ? Number.POSITIVE_INFINITY
            : summary.full.medianMs / summary.incremental.medianMs,
      })),
    };
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  console.log('incremental tree index benchmark');
  console.log(
    `bun=${environment.bunVersion} platform=${environment.platform} arch=${environment.arch}`
  );
  console.log(
    `runsPerOperation=${config.runs} warmupRunsPerOperation=${config.warmupRuns}`
  );
  console.log(
    `branching=${config.branching} depth=${config.depth} filesPerFolder=${config.filesPerFolder}`
  );
  console.log('');

  printTable(
    summaries.map((summary) => {
      const speedup =
        summary.incremental.medianMs === 0
          ? Number.POSITIVE_INFINITY
          : summary.full.medianMs / summary.incremental.medianMs;

      return {
        operation: summary.operation,
        incrementalMedianMs: formatMs(summary.incremental.medianMs),
        fullMedianMs: formatMs(summary.full.medianMs),
        speedupMedianX: Number.isFinite(speedup)
          ? `${speedup.toFixed(2)}x`
          : 'inf',
      };
    }),
    ['operation', 'incrementalMedianMs', 'fullMedianMs', 'speedupMedianX']
  );
}

main();
