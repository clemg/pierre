import { getWorkloadOption, type TreesWorkloadOption } from './workloadMeta';

export type BulkExperimentWorkloadName = 'linux-1x' | 'linux-5x' | 'linux-10x';
export type BulkExperimentIngestMode = 'chunked' | 'oneshot';
export type BulkExperimentExpansionMode = 'all-open' | 'all-closed' | 'seeded';

export const BULK_PREVIEW_PATH_COUNT = 100;
export const BULK_EXPERIMENT_CHUNK_SIZE = 40_000;
export const DEFAULT_BULK_EXPERIMENT_WORKLOAD_NAME: BulkExperimentWorkloadName =
  'linux-5x';
export const DEFAULT_BULK_EXPERIMENT_INGEST_MODE: BulkExperimentIngestMode =
  'chunked';
export const DEFAULT_BULK_EXPERIMENT_EXPANSION_MODE: BulkExperimentExpansionMode =
  'all-open';

export const BULK_EXPERIMENT_WORKLOAD_NAMES = [
  'linux-1x',
  'linux-5x',
  'linux-10x',
] as const satisfies readonly BulkExperimentWorkloadName[];

export const BULK_EXPERIMENT_WORKLOAD_OPTIONS =
  BULK_EXPERIMENT_WORKLOAD_NAMES.map((name) =>
    getWorkloadOption(name)
  ) satisfies readonly TreesWorkloadOption[];

export const BULK_EXPERIMENT_INGEST_OPTIONS = [
  { label: 'Chunked apply', value: 'chunked' },
  { label: 'One-shot apply', value: 'oneshot' },
] as const satisfies readonly {
  label: string;
  value: BulkExperimentIngestMode;
}[];

export const BULK_EXPERIMENT_EXPANSION_OPTIONS = [
  { label: 'All open', value: 'all-open' },
  { label: 'All closed', value: 'all-closed' },
  { label: 'Seeded', value: 'seeded' },
] as const satisfies readonly {
  label: string;
  value: BulkExperimentExpansionMode;
}[];

const BULK_WORKLOAD_ASSET_URL_BY_NAME = {
  'linux-1x': '/trees-dev/linux-1x.json.gz',
  'linux-5x': '/trees-dev/linux-5x.json.gz',
  'linux-10x': '/trees-dev/linux-10x.json.gz',
} as const satisfies Record<BulkExperimentWorkloadName, string>;

const SEEDED_RELATIVE_EXPANDED_PATHS = [
  'arch/',
  'drivers/',
  'include/',
] as const;

function createReplicaRootNames(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `linux-${index + 1}`);
}

// Keeps the seeded mode intentionally small so the experiment can exercise a
// mixed expansion state without carrying the large per-workload expanded-folder
// fixtures that the main demo uses.
export function getBulkExperimentSeededExpandedPaths(
  workloadName: BulkExperimentWorkloadName
): readonly string[] {
  if (workloadName === 'linux-1x') {
    return [...SEEDED_RELATIVE_EXPANDED_PATHS];
  }

  const rootCount = workloadName === 'linux-5x' ? 5 : 10;
  const seededPaths = new Array<string>(
    rootCount + rootCount * SEEDED_RELATIVE_EXPANDED_PATHS.length
  );
  let nextIndex = 0;

  for (const rootName of createReplicaRootNames(rootCount)) {
    seededPaths[nextIndex++] = `${rootName}/`;
    for (const relativePath of SEEDED_RELATIVE_EXPANDED_PATHS) {
      seededPaths[nextIndex++] = `${rootName}/${relativePath}`;
    }
  }

  return seededPaths;
}

export function getBulkExperimentAssetUrl(
  workloadName: BulkExperimentWorkloadName
): string {
  return BULK_WORKLOAD_ASSET_URL_BY_NAME[workloadName];
}
