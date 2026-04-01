import { FileTreeModel } from '../src/model/FileTreeModel';
import {
  formatMs,
  getEnvironment,
  parseNonNegativeInteger,
  parsePositiveInteger,
  printTable,
  summarizeSamples,
  type TimingSummary,
} from './lib/benchmarkUtils';

type FixtureShape = 'wide' | 'deep';
type ShapeSelection = FixtureShape | 'both';

type MutationOperationName =
  | 'rename-file'
  | 'rename-folder'
  | 'move-file'
  | 'move-folder'
  | 'add-path'
  | 'delete-path';

interface BenchmarkConfig {
  runs: number;
  warmupRuns: number;
  smallNoise: number;
  largeNoise: number;
  shape: ShapeSelection;
  warmPathTree: boolean;
  outputJson: boolean;
}

interface CounterCollector {
  counters: Record<string, number>;
  instrumentation: {
    measurePhase: <TValue>(name: string, fn: () => TValue) => TValue;
    setCounter: (name: string, value: number) => void;
  };
}

interface OperationDefinition {
  name: MutationOperationName;
  counterName: string;
  run: (model: FileTreeModel) => { ok: boolean; error?: string };
}

interface OperationMeasurement {
  timing: TimingSummary;
  counter: TimingSummary;
}

interface OperationRow {
  shape: FixtureShape;
  operation: MutationOperationName;
  counterName: string;
  smallNoise: number;
  largeNoise: number;
  smallTiming: TimingSummary;
  largeTiming: TimingSummary;
  smallCounter: TimingSummary;
  largeCounter: TimingSummary;
  timingScale: number;
  counterScale: number;
}

interface BenchmarkOutput {
  benchmark: 'modelMutationComplexity';
  environment: ReturnType<typeof getEnvironment>;
  config: BenchmarkConfig;
  rows: OperationRow[];
}

const DEFAULT_CONFIG: BenchmarkConfig = {
  runs: 25,
  warmupRuns: 5,
  smallNoise: 10,
  largeNoise: 1500,
  shape: 'both',
  warmPathTree: true,
  outputJson: false,
};

const OPERATIONS: OperationDefinition[] = [
  {
    name: 'rename-file',
    counterName: 'model.rename.file.remapScannedNodes',
    run: (model) =>
      model.renamePath({
        sourcePath: 'workspace/src/deep/nested/file-a.ts',
        destinationPath: 'workspace/src/deep/nested/file-a-renamed.ts',
        isFolder: false,
      }),
  },
  {
    name: 'rename-folder',
    counterName: 'model.rename.folder.remapScannedNodes',
    run: (model) =>
      model.renamePath({
        sourcePath: 'workspace/src/deep',
        destinationPath: 'workspace/src/deep-renamed',
        isFolder: true,
      }),
  },
  {
    name: 'move-file',
    counterName: 'model.move.remapScannedNodes',
    run: (model) =>
      model.movePaths({
        draggedPaths: ['workspace/src/deep/nested/file-a.ts'],
        targetPath: 'workspace/target',
      }),
  },
  {
    name: 'move-folder',
    counterName: 'model.move.remapScannedNodes',
    run: (model) =>
      model.movePaths({
        draggedPaths: ['workspace/src/deep'],
        targetPath: 'workspace/target',
      }),
  },
  {
    name: 'add-path',
    counterName: 'model.rebuildFolders.executedCount',
    run: (model) =>
      model.addPaths({
        paths: ['workspace/src/deep/nested/added.ts'],
      }),
  },
  {
    name: 'delete-path',
    counterName: 'model.rebuildFolders.executedCount',
    run: (model) =>
      model.deletePaths({
        paths: ['workspace/src/deep/nested/file-b.ts'],
      }),
  },
];

function printHelpAndExit(): never {
  console.log('Usage: bun ws trees benchmark:model-mutations -- [options]');
  console.log('');
  console.log('Options:');
  console.log(
    '  --runs <number>          Measured runs per shape/operation (default: 25)'
  );
  console.log(
    '  --warmup-runs <number>   Warmup runs per shape/operation (default: 5)'
  );
  console.log(
    '  --small-noise <number>   Unrelated fixture size for baseline (default: 10)'
  );
  console.log(
    '  --large-noise <number>   Unrelated fixture size for scale check (default: 1500)'
  );
  console.log('  --shape <value>          wide | deep | both (default: both)');
  console.log(
    '  --cold-path-tree         Include one-time path-tree creation in mutation timings'
  );
  console.log('  --json                   Emit machine-readable JSON output');
  console.log('  -h, --help               Show this help output');
  process.exit(0);
}

function parseShape(value: string): ShapeSelection {
  if (value === 'wide' || value === 'deep' || value === 'both') {
    return value;
  }

  throw new Error(
    `Invalid --shape value '${value}'. Expected one of: wide, deep, both.`
  );
}

function parseArgs(argv: string[]): BenchmarkConfig {
  const config: BenchmarkConfig = { ...DEFAULT_CONFIG };

  for (let index = 0; index < argv.length; index += 1) {
    const rawArg = argv[index];

    if (rawArg === '--help' || rawArg === '-h') {
      printHelpAndExit();
    }

    if (rawArg === '--json') {
      config.outputJson = true;
      continue;
    }

    if (rawArg === '--cold-path-tree') {
      config.warmPathTree = false;
      continue;
    }

    const [flag, inlineValue] = rawArg.split('=', 2);
    if (
      flag !== '--runs' &&
      flag !== '--warmup-runs' &&
      flag !== '--small-noise' &&
      flag !== '--large-noise' &&
      flag !== '--shape'
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
    } else if (flag === '--small-noise') {
      config.smallNoise = parseNonNegativeInteger(value, '--small-noise');
    } else if (flag === '--large-noise') {
      config.largeNoise = parseNonNegativeInteger(value, '--large-noise');
    } else {
      config.shape = parseShape(value);
    }
  }

  return config;
}

function createCounterCollector(): CounterCollector {
  const counters: Record<string, number> = {};

  return {
    counters,
    instrumentation: {
      measurePhase: (_name, fn) => fn(),
      setCounter: (name, value) => {
        counters[name] = value;
      },
    },
  };
}

function createFixtureFiles(
  unrelatedFileCount: number,
  shape: FixtureShape
): string[] {
  const files = [
    'workspace/src/deep/nested/file-a.ts',
    'workspace/src/deep/nested/file-b.ts',
    'workspace/src/deep/root-file.ts',
    'workspace/target/keep.ts',
  ];

  for (let index = 0; index < unrelatedFileCount; index += 1) {
    if (shape === 'wide') {
      files.push(`noise-${index}/file-${index}.ts`);
      continue;
    }

    let parentPath = `noise-${index}`;
    for (let depth = 0; depth < 8; depth += 1) {
      parentPath = `${parentPath}/segment-${depth}`;
    }
    files.push(`${parentPath}/file-${index}.ts`);
  }

  return files;
}

function safeScale(large: number, small: number): number {
  if (small === 0) {
    return large === 0 ? 1 : Number.POSITIVE_INFINITY;
  }
  return large / small;
}

function primePathTree(model: FileTreeModel): void {
  model.deletePaths({
    paths: ['__complexity__/missing-path.ts'],
  });
}

function runOperationMeasurement(
  config: BenchmarkConfig,
  shape: FixtureShape,
  unrelatedFileCount: number,
  operation: OperationDefinition
): OperationMeasurement {
  const timingSamples: number[] = [];
  const counterSamples: number[] = [];
  const totalRuns = config.runs + config.warmupRuns;

  for (let runIndex = 0; runIndex < totalRuns; runIndex += 1) {
    const { counters, instrumentation } = createCounterCollector();
    const model = FileTreeModel.fromFiles(
      createFixtureFiles(unrelatedFileCount, shape),
      {
        sortComparator: false,
        benchmarkInstrumentation: instrumentation,
      }
    );

    if (config.warmPathTree) {
      primePathTree(model);
    }

    const startTime = performance.now();
    const result = operation.run(model);
    const durationMs = performance.now() - startTime;

    if (result.ok !== true) {
      const errorMessage = result.error ?? 'Unknown mutation error';
      throw new Error(
        `${operation.name} failed for ${shape} fixture (${unrelatedFileCount} unrelated files): ${errorMessage}`
      );
    }

    if (runIndex < config.warmupRuns) {
      continue;
    }

    timingSamples.push(durationMs);
    counterSamples.push(counters[operation.counterName] ?? 0);
  }

  return {
    timing: summarizeSamples(timingSamples),
    counter: summarizeSamples(counterSamples),
  };
}

function resolveShapes(selection: ShapeSelection): FixtureShape[] {
  if (selection === 'both') {
    return ['wide', 'deep'];
  }
  return [selection];
}

function runBenchmark(config: BenchmarkConfig): BenchmarkOutput {
  const rows: OperationRow[] = [];
  const shapes = resolveShapes(config.shape);

  for (let shapeIndex = 0; shapeIndex < shapes.length; shapeIndex += 1) {
    const shape = shapes[shapeIndex];

    for (
      let operationIndex = 0;
      operationIndex < OPERATIONS.length;
      operationIndex += 1
    ) {
      const operation = OPERATIONS[operationIndex];

      const small = runOperationMeasurement(
        config,
        shape,
        config.smallNoise,
        operation
      );
      const large = runOperationMeasurement(
        config,
        shape,
        config.largeNoise,
        operation
      );

      rows.push({
        shape,
        operation: operation.name,
        counterName: operation.counterName,
        smallNoise: config.smallNoise,
        largeNoise: config.largeNoise,
        smallTiming: small.timing,
        largeTiming: large.timing,
        smallCounter: small.counter,
        largeCounter: large.counter,
        timingScale: safeScale(large.timing.medianMs, small.timing.medianMs),
        counterScale: safeScale(large.counter.medianMs, small.counter.medianMs),
      });
    }
  }

  return {
    benchmark: 'modelMutationComplexity',
    environment: getEnvironment(),
    config,
    rows,
  };
}

function printBenchmark(output: BenchmarkOutput): void {
  const rows = output.rows.map((row) => ({
    Shape: row.shape,
    Operation: row.operation,
    Counter: row.counterName,
    'Small median (ms)': formatMs(row.smallTiming.medianMs),
    'Large median (ms)': formatMs(row.largeTiming.medianMs),
    'Timing scale x': Number.isFinite(row.timingScale)
      ? row.timingScale.toFixed(2)
      : 'inf',
    'Small counter': row.smallCounter.medianMs.toFixed(1),
    'Large counter': row.largeCounter.medianMs.toFixed(1),
    'Counter scale x': Number.isFinite(row.counterScale)
      ? row.counterScale.toFixed(2)
      : 'inf',
  }));

  printTable(rows, [
    'Shape',
    'Operation',
    'Counter',
    'Small median (ms)',
    'Large median (ms)',
    'Timing scale x',
    'Small counter',
    'Large counter',
    'Counter scale x',
  ]);
}

const config = parseArgs(process.argv.slice(2));
const output = runBenchmark(config);

if (config.outputJson) {
  console.log(JSON.stringify(output, null, 2));
} else {
  printBenchmark(output);
}
