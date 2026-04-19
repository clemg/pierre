import type { FileTreeBulkIngestInfo } from '@pierre/trees';

import type {
  BulkExperimentExpansionMode,
  BulkExperimentIngestMode,
  BulkExperimentWorkloadName,
} from './bulkExperimentMeta';

export interface BulkExperimentVisibleSegment {
  isTerminal: boolean;
  name: string;
  path: string;
}

export interface BulkExperimentVisibleRow {
  ancestorPaths: readonly string[];
  depth: number;
  flattenedSegments?: readonly BulkExperimentVisibleSegment[];
  hasChildren: boolean;
  index: number;
  isExpanded: boolean;
  isFlattened: boolean;
  kind: 'directory' | 'file';
  level: number;
  name: string;
  path: string;
  posInSet: number;
  setSize: number;
}

export interface BulkExperimentRunMetrics {
  applyMs: number;
  fetchMs: number;
  ingestMode: BulkExperimentIngestMode;
  parseMs: number;
  totalMs: number;
  workloadName: BulkExperimentWorkloadName;
  expansionMode: BulkExperimentExpansionMode;
}

export interface BulkExperimentSnapshot {
  bulkInfo: FileTreeBulkIngestInfo;
  ingestMode: BulkExperimentIngestMode;
  metrics: BulkExperimentRunMetrics | null;
  visibleCount: number;
  workloadName: BulkExperimentWorkloadName;
  expansionMode: BulkExperimentExpansionMode;
}

export interface BulkExperimentInitOptions {
  assetUrl: string;
  expansionMode: BulkExperimentExpansionMode;
  ingestMode: BulkExperimentIngestMode;
  previewPaths: readonly string[];
  seededExpandedPaths: readonly string[];
  totalPathCount: number;
  workloadName: BulkExperimentWorkloadName;
}

export type BulkExperimentWorkerRequest =
  | { id: number; type: 'cancelIngest' }
  | { id: number; type: 'collapsePath'; path: string }
  | { id: number; type: 'dispose' }
  | { id: number; type: 'expandPath'; path: string }
  | { id: number; type: 'getVisibleRows'; end: number; start: number }
  | { id: number; type: 'initialize'; options: BulkExperimentInitOptions }
  | { id: number; type: 'startIngest' };

export type BulkExperimentWorkerResponse =
  | { id: number; type: 'ack' }
  | { error: string; id: number; type: 'error' }
  | {
      id: number;
      rows: readonly BulkExperimentVisibleRow[];
      type: 'visibleRows';
    };

export interface BulkExperimentWorkerSnapshotMessage {
  snapshot: BulkExperimentSnapshot;
  type: 'snapshot';
}

export type BulkExperimentWorkerMessage =
  | BulkExperimentWorkerResponse
  | BulkExperimentWorkerSnapshotMessage;
