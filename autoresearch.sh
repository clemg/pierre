#!/bin/bash
set -euo pipefail

export AGENT=1

# Fast syntax/module-load precheck before running the benchmark loop.
bun --eval "import './packages/trees/src/utils/fileListToTree.ts';" >/dev/null

bun --eval '
const decoder = new TextDecoder();
const repeats = Number(process.env.AR_REPEATS ?? "5");
const benchmarkArgs = [
  "bun",
  "ws",
  "trees",
  "benchmark:file-list-to-tree",
  "--",
  "--case=linux",
  "--runs=7",
  "--warmup-runs=2",
  "--json",
];

const totalMedians = [];
const totalP95 = [];
const buildPathGraphMedians = [];
const buildFlattenedNodesMedians = [];
const buildFolderNodesMedians = [];
const hashTreeKeysMedians = [];

for (let runIndex = 0; runIndex < repeats; runIndex += 1) {
  const benchmarkRun = Bun.spawnSync(benchmarkArgs, {
    stdout: "pipe",
    stderr: "pipe",
  });

  if (benchmarkRun.exitCode !== 0) {
    process.stderr.write(decoder.decode(benchmarkRun.stderr));
    process.exit(benchmarkRun.exitCode ?? 1);
  }

  const payload = JSON.parse(decoder.decode(benchmarkRun.stdout)) as {
    cases: Array<{ name: string; medianMs: number; p95Ms: number }>;
    stages: Array<{
      name: string;
      stages: {
        buildPathGraph: { medianMs: number };
        buildFlattenedNodes: { medianMs: number };
        buildFolderNodes: { medianMs: number };
        hashTreeKeys: { medianMs: number };
      };
    }>;
  };

  const caseSummary = payload.cases.find(
    (entry) => entry.name === "fixture-linux-kernel-files"
  );
  const stageSummary = payload.stages.find(
    (entry) => entry.name === "fixture-linux-kernel-files"
  );

  if (caseSummary == null || stageSummary == null) {
    throw new Error(
      "linux benchmark case not found in benchmark output (fixture-linux-kernel-files)."
    );
  }

  totalMedians.push(caseSummary.medianMs);
  totalP95.push(caseSummary.p95Ms);
  buildPathGraphMedians.push(stageSummary.stages.buildPathGraph.medianMs);
  buildFlattenedNodesMedians.push(
    stageSummary.stages.buildFlattenedNodes.medianMs
  );
  buildFolderNodesMedians.push(stageSummary.stages.buildFolderNodes.medianMs);
  hashTreeKeysMedians.push(stageSummary.stages.hashTreeKeys.medianMs);
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function metric(value: number): string {
  return value.toFixed(6);
}

console.log(`METRIC linux_total_median_ms=${metric(median(totalMedians))}`);
console.log(`METRIC linux_buildPathGraph_median_ms=${metric(median(buildPathGraphMedians))}`);
console.log(`METRIC linux_buildFlattenedNodes_median_ms=${metric(median(buildFlattenedNodesMedians))}`);
console.log(`METRIC linux_buildFolderNodes_median_ms=${metric(median(buildFolderNodesMedians))}`);
console.log(`METRIC linux_hashTreeKeys_median_ms=${metric(median(hashTreeKeysMedians))}`);
console.log(`METRIC linux_total_p95_ms=${metric(median(totalP95))}`);
console.log(`METRIC autoresearch_repeats=${repeats}`);
'