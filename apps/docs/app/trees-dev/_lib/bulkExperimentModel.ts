import type { FileTreeBulkIngestInfo } from '@pierre/trees';

import { PathStore } from '../../../../../packages/path-store/src/index';
import type {
  PathStoreVisibleRow,
  PathStoreVisibleTreeProjectionData,
} from '../../../../../packages/path-store/src/index';
import { BULK_EXPERIMENT_CHUNK_SIZE } from './bulkExperimentMeta';
import type {
  BulkExperimentInitOptions,
  BulkExperimentRunMetrics,
  BulkExperimentSnapshot,
  BulkExperimentVisibleRow,
} from './bulkExperimentProtocol';
import {
  fetchUpgradePayloadWithTimings,
  type UpgradePayloadTimings,
} from './fetchUpgradePayload';

type ProjectionIndexBuffer = Int32Array;
type SnapshotListener = (snapshot: BulkExperimentSnapshot) => void;

interface BulkExperimentVisibleProjection {
  getParentIndex(index: number): number;
  paths: readonly string[];
  posInSetByIndex: ProjectionIndexBuffer;
  setSizeByIndex: ProjectionIndexBuffer;
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function createAbortError(): DOMException {
  return new DOMException('The operation was aborted.', 'AbortError');
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function createVisibleProjection(
  projection: PathStoreVisibleTreeProjectionData
): BulkExperimentVisibleProjection {
  return {
    getParentIndex: projection.getParentIndex,
    paths: projection.paths,
    posInSetByIndex: projection.posInSetByIndex,
    setSizeByIndex: projection.setSizeByIndex,
  };
}

async function yieldForNextTurn(): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

// Validates that the generated preview slice and fetched asset still describe the
// same workload so appendPreparedInput can stay on its append-only fast path.
function assertPreviewPrefix(
  previewPaths: readonly string[],
  fullPaths: readonly string[],
  workloadName: string
): void {
  const previewLength = previewPaths.length;
  const previewPrefix = fullPaths.slice(0, previewLength);
  if (
    previewPrefix.length !== previewLength ||
    previewPrefix.some((path, index) => path !== previewPaths[index])
  ) {
    throw new Error(
      `${workloadName} preview seed is not a prefix of the fetched workload asset.`
    );
  }
}

// Owns the experiment's PathStore and exposes a tiny snapshot/query surface that
// can run directly on the main thread or behind a worker message boundary.
export class BulkExperimentModel {
  readonly #ancestorPathsByIndex = new Map<number, readonly string[]>();
  readonly #config: BulkExperimentInitOptions;
  #bulkInfo: FileTreeBulkIngestInfo;
  #disposed = false;
  #ingestAbortController: AbortController | null = null;
  readonly #listeners = new Set<SnapshotListener>();
  #metrics: BulkExperimentRunMetrics | null = null;
  #getParentIndexForVisibleRow = (_index: number): number => -1;
  #projectionPaths: readonly string[] = [];
  #projectionPosInSetByIndex: ProjectionIndexBuffer = new Int32Array(0);
  #projectionSetSizeByIndex: ProjectionIndexBuffer = new Int32Array(0);
  readonly #store: PathStore;
  #visibleCount = 0;

  public constructor(config: BulkExperimentInitOptions) {
    this.#config = config;
    this.#bulkInfo = {
      ingestedPathCount: config.previewPaths.length,
      status: 'idle',
      totalPathCount: config.totalPathCount,
    };
    this.#store = new PathStore({
      flattenEmptyDirectories: false,
      ...this.#getInitialExpansionOptions(),
      preparedInput: PathStore.preparePresortedInput(config.previewPaths),
    });
    this.#rebuildVisibleProjection();
  }

  public destroy(): void {
    this.#disposed = true;
    this.#ingestAbortController?.abort();
    this.#ingestAbortController = null;
    this.#listeners.clear();
  }

  public subscribe(listener: SnapshotListener): () => void {
    this.#listeners.add(listener);
    listener(this.getSnapshot());
    return () => {
      this.#listeners.delete(listener);
    };
  }

  public getSnapshot(): BulkExperimentSnapshot {
    return {
      bulkInfo: { ...this.#bulkInfo },
      expansionMode: this.#config.expansionMode,
      ingestMode: this.#config.ingestMode,
      metrics: this.#metrics,
      visibleCount: this.#visibleCount,
      workloadName: this.#config.workloadName,
    };
  }

  public getVisibleRows(
    start: number,
    end: number
  ): readonly BulkExperimentVisibleRow[] {
    if (end < start || this.#visibleCount === 0) {
      return [];
    }

    const boundedStart = Math.max(0, start);
    const boundedEnd = Math.min(this.#visibleCount - 1, end);
    if (boundedEnd < boundedStart) {
      return [];
    }

    return this.#store
      .getVisibleSlice(boundedStart, boundedEnd)
      .map((row: PathStoreVisibleRow, offset: number) => {
        const index = boundedStart + offset;
        const projectionPath = this.#projectionPaths[index];
        if (projectionPath == null) {
          throw new Error(
            `Missing projection path for visible index ${String(index)}`
          );
        }

        return {
          ancestorPaths: this.#getAncestorPaths(index),
          depth: row.depth,
          flattenedSegments: row.flattenedSegments?.map((segment) => ({
            isTerminal: segment.isTerminal,
            name: segment.name,
            path: segment.path,
          })),
          hasChildren: row.hasChildren,
          index,
          isExpanded: row.isExpanded,
          isFlattened: row.isFlattened,
          kind: row.kind,
          level: row.depth,
          name: row.name,
          path: projectionPath,
          posInSet: this.#projectionPosInSetByIndex[index] ?? 0,
          setSize: this.#projectionSetSizeByIndex[index] ?? 0,
        } satisfies BulkExperimentVisibleRow;
      });
  }

  public async startIngest(): Promise<void> {
    if (this.#ingestAbortController != null || this.#disposed) {
      return;
    }

    this.#metrics = null;
    this.#bulkInfo = {
      errorMessage: undefined,
      ingestedPathCount: this.#config.previewPaths.length,
      status: 'ingesting',
      totalPathCount: this.#config.totalPathCount,
    };
    this.#emit();

    const abortController = new AbortController();
    this.#ingestAbortController = abortController;
    void this.#runIngest(abortController.signal);
  }

  public cancelIngest(): void {
    this.#ingestAbortController?.abort();
  }

  public expandPath(path: string): void {
    this.#withDirectoryPath(path, (canonicalPath) => {
      this.#store.expand(canonicalPath);
      this.#rebuildVisibleProjection();
      this.#emit();
    });
  }

  public collapsePath(path: string): void {
    this.#withDirectoryPath(path, (canonicalPath) => {
      this.#store.collapse(canonicalPath);
      this.#rebuildVisibleProjection();
      this.#emit();
    });
  }

  #getInitialExpansionOptions(): {
    initialExpandedPaths?: readonly string[];
    initialExpansion: 'closed' | 'open';
  } {
    switch (this.#config.expansionMode) {
      case 'all-open':
        return { initialExpansion: 'open' };
      case 'seeded':
        return {
          initialExpandedPaths: this.#config.seededExpandedPaths,
          initialExpansion: 'closed',
        };
      default:
        return { initialExpansion: 'closed' };
    }
  }

  #getAncestorPaths(index: number): readonly string[] {
    const cached = this.#ancestorPathsByIndex.get(index);
    if (cached != null) {
      return cached;
    }

    const parentIndex = this.#getParentIndexForVisibleRow(index);
    const ancestorPaths =
      parentIndex < 0
        ? []
        : [
            ...this.#getAncestorPaths(parentIndex),
            this.#projectionPaths[parentIndex] ?? '',
          ].filter((path) => path !== '');
    this.#ancestorPathsByIndex.set(index, ancestorPaths);
    return ancestorPaths;
  }

  #rebuildVisibleProjection(): void {
    const rawVisibleCount = this.#store.getVisibleCount();
    const projection = createVisibleProjection(
      this.#store.getVisibleTreeProjectionData()
    );

    this.#ancestorPathsByIndex.clear();
    this.#visibleCount = rawVisibleCount;
    this.#getParentIndexForVisibleRow = projection.getParentIndex;
    this.#projectionPaths = projection.paths;
    this.#projectionPosInSetByIndex = projection.posInSetByIndex;
    this.#projectionSetSizeByIndex = projection.setSizeByIndex;
  }

  #emit(): void {
    if (this.#disposed) {
      return;
    }

    const snapshot = this.getSnapshot();
    this.#listeners.forEach((listener) => {
      listener(snapshot);
    });
  }

  #withDirectoryPath(
    path: string,
    action: (canonicalPath: string) => void
  ): void {
    if (this.#disposed) {
      return;
    }

    const pathInfo = this.#store.getPathInfo(path);
    if (pathInfo?.kind !== 'directory') {
      return;
    }

    action(pathInfo.path);
  }

  #applySeededExpansions(): void {
    if (this.#config.expansionMode !== 'seeded') {
      return;
    }

    for (const path of this.#config.seededExpandedPaths) {
      const pathInfo = this.#store.getPathInfo(path);
      if (pathInfo?.kind !== 'directory') {
        continue;
      }

      this.#store.expand(pathInfo.path);
    }
  }

  #appendPresortedPaths(
    paths: readonly string[],
    nextIngestedPathCount: number
  ): void {
    if (paths.length === 0 || this.#disposed) {
      return;
    }

    this.#store.appendPreparedInput(PathStore.preparePresortedInput(paths));
    this.#applySeededExpansions();
    this.#bulkInfo = {
      ...this.#bulkInfo,
      ingestedPathCount: nextIngestedPathCount,
    };
    this.#rebuildVisibleProjection();
    this.#emit();
  }

  #finalizeRun(
    status: FileTreeBulkIngestInfo['status'],
    timings: UpgradePayloadTimings,
    applyStartedAt: number,
    runStartedAt: number,
    errorMessage?: string
  ): void {
    const applyMs = applyStartedAt === 0 ? 0 : now() - applyStartedAt;
    this.#metrics = {
      applyMs,
      expansionMode: this.#config.expansionMode,
      fetchMs: timings.fetchMs,
      ingestMode: this.#config.ingestMode,
      parseMs: timings.parseMs,
      totalMs: now() - runStartedAt,
      workloadName: this.#config.workloadName,
    };
    this.#bulkInfo = {
      errorMessage,
      ingestedPathCount: this.#bulkInfo.ingestedPathCount,
      status,
      totalPathCount: this.#bulkInfo.totalPathCount,
    };
    this.#emit();
  }

  async #runIngest(signal: AbortSignal): Promise<void> {
    const runStartedAt = now();
    const timings: UpgradePayloadTimings = { fetchMs: 0, parseMs: 0 };
    let applyStartedAt = 0;

    try {
      const { payload, timings: nextTimings } =
        await fetchUpgradePayloadWithTimings(this.#config.assetUrl, signal);
      timings.fetchMs = nextTimings.fetchMs;
      timings.parseMs = nextTimings.parseMs;
      if (signal.aborted) {
        throw createAbortError();
      }

      assertPreviewPrefix(
        this.#config.previewPaths,
        payload.paths,
        this.#config.workloadName
      );

      this.#bulkInfo = {
        ...this.#bulkInfo,
        totalPathCount: payload.paths.length,
      };
      this.#emit();

      const previewLength = this.#config.previewPaths.length;
      const remainingPaths = payload.paths.slice(previewLength);
      applyStartedAt = now();

      if (this.#config.ingestMode === 'oneshot') {
        this.#appendPresortedPaths(remainingPaths, payload.paths.length);
      } else {
        for (
          let index = 0;
          index < remainingPaths.length;
          index += BULK_EXPERIMENT_CHUNK_SIZE
        ) {
          if (signal.aborted) {
            throw createAbortError();
          }

          const chunk = remainingPaths.slice(
            index,
            index + BULK_EXPERIMENT_CHUNK_SIZE
          );
          this.#appendPresortedPaths(
            chunk,
            previewLength + index + chunk.length
          );
          await yieldForNextTurn();
        }
      }

      this.#finalizeRun('completed', timings, applyStartedAt, runStartedAt);
    } catch (error) {
      if (this.#disposed) {
        return;
      }

      if (isAbortError(error) || signal.aborted) {
        this.#finalizeRun('cancelled', timings, applyStartedAt, runStartedAt);
      } else {
        this.#finalizeRun(
          'failed',
          timings,
          applyStartedAt,
          runStartedAt,
          toErrorMessage(error)
        );
      }
    } finally {
      if (this.#ingestAbortController?.signal === signal) {
        this.#ingestAbortController = null;
      }
    }
  }
}
