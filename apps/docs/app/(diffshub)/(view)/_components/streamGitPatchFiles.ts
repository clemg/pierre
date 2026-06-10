import { COMMIT_HASH_METADATA_PATTERN } from './gitPatchMetadata';

// Splits the patch byte stream into one Uint8Array per file at `diff --git`
// boundaries, without ever decoding the bulk of the patch to a JS string: the
// per-file bytes go straight into `processFileBytes`, which only decodes the
// small metadata regions. Only the no-boundary fallback (a non-git patch)
// decodes the accumulated bytes, since that path hands a full patch string to
// the string parser

const GIT_FILE_BOUNDARY = 'diff --git ';
const COMMIT_BOUNDARY = 'From ';
const COMMIT_BOUNDARY_FIRST_BYTE = COMMIT_BOUNDARY.charCodeAt(0);
const NEWLINE = 10;

const metadataDecoder = new TextDecoder();

export async function streamGitPatchFiles(
  body: ReadableStream<Uint8Array>,
  onFileBytes: (fileBytes: Uint8Array) => Promise<void>
): Promise<string | undefined> {
  const reader = body.getReader();
  const parser = createGitPatchFileStreamParser();

  try {
    for (;;) {
      const result = await reader.read();
      if (result.done) {
        break;
      }
      if (result.value.byteLength > 0) {
        parser.push(result.value);
        await consumeAvailableStreamedFiles(parser, onFileBytes);
      }
    }

    const result = parser.finish();
    if (result.fileBytes != null) {
      await onFileBytes(result.fileBytes);
    }
    let fileBytes: Uint8Array | undefined;
    while ((fileBytes = parser.takeAvailableFile()) != null) {
      await onFileBytes(fileBytes);
    }
    return result.fallbackPatchContent;
  } finally {
    reader.releaseLock();
  }
}

// The splitter keeps a format-patch's commit metadata (the `From <hash>`
// block) at the head of the commit's first file slice; read it back from
// there, if any
export function getStreamedPatchMetadata(
  fileBytes: Uint8Array
): string | undefined {
  const boundaryIndex = findGitFileBoundary(fileBytes, fileBytes.length, 0);
  if (boundaryIndex == null || boundaryIndex <= 0) {
    return undefined;
  }

  const metadata = metadataDecoder.decode(fileBytes.subarray(0, boundaryIndex));
  return COMMIT_HASH_METADATA_PATTERN.test(metadata) ? metadata : undefined;
}

interface GitPatchFileStreamFinishResult {
  fallbackPatchContent?: string;
  fileBytes?: Uint8Array;
}

interface GitPatchFileStreamParser {
  finish(): GitPatchFileStreamFinishResult;
  push(chunk: Uint8Array): void;
  takeAvailableFile(): Uint8Array | undefined;
}

async function consumeAvailableStreamedFiles(
  parser: GitPatchFileStreamParser,
  onFileBytes: (fileBytes: Uint8Array) => Promise<void>
): Promise<void> {
  let fileBytes: Uint8Array | undefined;
  while ((fileBytes = parser.takeAvailableFile()) != null) {
    await onFileBytes(fileBytes);
  }
}

// Buffers the current file until the following `diff --git` header arrives so
// each parsed file is complete before it is appended to the viewer. Emitted
// slices are views into the internal buffer: they stay valid until the next
// `push`, which is enough because each file is consumed before more bytes are
// read from the stream
function createGitPatchFileStreamParser(): GitPatchFileStreamParser {
  let buffer = new Uint8Array(1 << 16);
  // Consumed/used window into `buffer`; emitted files start at `start`
  let start = 0;
  let end = 0;
  // Absolute offset of the current file's `diff --git` line, or null until
  // one is found
  let currentFileBoundaryIndex: number | null = null;
  // Line start where the boundary scan resumes (never re-scans settled bytes)
  let nextBoundarySearchIndex = 0;
  let sawFileBoundary = false;
  let strippedLeadingBOM = false;

  function push(chunk: Uint8Array): void {
    if (chunk.length === 0) {
      return;
    }
    if (end + chunk.length > buffer.length) {
      // Bytes before `start` are settled (emitted or skipped) and every scan
      // position sits at or after `start`, so compaction can always drop them
      const liveLength = end - start;
      if (liveLength + chunk.length > buffer.length) {
        let capacity = buffer.length * 2;
        while (capacity < liveLength + chunk.length) {
          capacity *= 2;
        }
        const grown = new Uint8Array(capacity);
        grown.set(buffer.subarray(start, end));
        buffer = grown;
      } else {
        buffer.copyWithin(0, start, end);
      }
      end -= start;
      nextBoundarySearchIndex -= start;
      if (currentFileBoundaryIndex != null) {
        currentFileBoundaryIndex -= start;
      }
      start = 0;
    }
    buffer.set(chunk, end);
    end += chunk.length;
    // The string pipeline's TextDecoder strips a stream-leading BOM; match
    // that so a BOM'd patch still parses its first `diff --git` header
    if (!strippedLeadingBOM && end - start >= 3) {
      strippedLeadingBOM = true;
      if (
        buffer[start] === 0xef &&
        buffer[start + 1] === 0xbb &&
        buffer[start + 2] === 0xbf
      ) {
        start += 3;
        nextBoundarySearchIndex = Math.max(nextBoundarySearchIndex, start);
      }
    }
  }

  // Next line start at or after `from` that begins with `diff --git `, or
  // null. On a miss, records the first line whose terminator has not arrived
  // yet as the resume point
  function findBoundary(from: number): number | null {
    let lineStart = from;
    for (;;) {
      const newlineIndex = buffer.indexOf(NEWLINE, lineStart);
      if (newlineIndex === -1 || newlineIndex >= end) {
        nextBoundarySearchIndex = lineStart;
        return null;
      }
      if (matchesAscii(buffer, lineStart, end, GIT_FILE_BOUNDARY)) {
        return lineStart;
      }
      lineStart = newlineIndex + 1;
    }
  }

  function takeAvailableFile(): Uint8Array | undefined {
    if (currentFileBoundaryIndex == null) {
      currentFileBoundaryIndex = findBoundary(nextBoundarySearchIndex);
      if (currentFileBoundaryIndex == null) {
        return undefined;
      }
      sawFileBoundary = true;
      nextBoundarySearchIndex = lineEndExclusive(currentFileBoundaryIndex);
    }

    for (;;) {
      const fileBoundaryIndex = currentFileBoundaryIndex;
      if (fileBoundaryIndex == null) {
        return undefined;
      }

      const nextBoundaryIndex = findBoundary(nextBoundarySearchIndex);
      if (nextBoundaryIndex == null) {
        return undefined;
      }

      const splitIndex =
        findLastCommitMetadataBoundary(
          fileBoundaryIndex + 1,
          nextBoundaryIndex
        ) ?? nextBoundaryIndex;
      const fileBytes = buffer.subarray(start, splitIndex);

      start = splitIndex;
      currentFileBoundaryIndex = nextBoundaryIndex;
      nextBoundarySearchIndex = lineEndExclusive(nextBoundaryIndex);
      if (hasNonWhitespace(fileBytes)) {
        return fileBytes;
      }
    }
  }

  function lineEndExclusive(index: number): number {
    const newlineIndex = buffer.indexOf(NEWLINE, index);
    return newlineIndex === -1 || newlineIndex >= end ? end : newlineIndex + 1;
  }

  // Backwards scan for the last `From <hash>` commit-metadata line strictly
  // inside (startIndex, endIndex), so a new commit's metadata attaches to the
  // commit's first file rather than the previous file. Anchored on the rare
  // `F` byte so a file span without any commit metadata costs only a few
  // candidate checks instead of a per-line walk
  function findLastCommitMetadataBoundary(
    startIndex: number,
    endIndex: number
  ): number | undefined {
    const minimumBoundaryIndex = Math.max(startIndex, start);
    const maximumBoundaryIndex = Math.min(endIndex, end);
    let searchIndex = maximumBoundaryIndex - 1;
    while (searchIndex >= minimumBoundaryIndex) {
      const candidate = buffer.lastIndexOf(
        COMMIT_BOUNDARY_FIRST_BYTE,
        searchIndex
      );
      if (candidate === -1 || candidate < minimumBoundaryIndex) {
        return undefined;
      }
      if (
        buffer[candidate - 1] === NEWLINE &&
        matchesAscii(buffer, candidate, end, COMMIT_BOUNDARY)
      ) {
        const lineEnd = lineEndExclusive(candidate);
        const line = metadataDecoder.decode(
          buffer.subarray(candidate, Math.min(lineEnd, maximumBoundaryIndex))
        );
        if (COMMIT_HASH_METADATA_PATTERN.test(line)) {
          return candidate;
        }
      }
      searchIndex = candidate - 1;
    }
    return undefined;
  }

  return {
    push,
    takeAvailableFile,
    finish(): GitPatchFileStreamFinishResult {
      const fileBytes = takeAvailableFile();
      if (fileBytes != null) {
        return { fileBytes };
      }

      const remaining = buffer.subarray(start, end);
      if (!hasNonWhitespace(remaining)) {
        start = end;
        return {};
      }
      if (!sawFileBoundary) {
        const fullPatchText = metadataDecoder.decode(remaining);
        start = end;
        return { fallbackPatchContent: fullPatchText };
      }

      start = end;
      return { fileBytes: remaining };
    },
  };
}

function matchesAscii(
  bytes: Uint8Array,
  index: number,
  end: number,
  text: string
): boolean {
  if (index + text.length > end) {
    return false;
  }
  for (let offset = 0; offset < text.length; offset++) {
    if (bytes[index + offset] !== text.charCodeAt(offset)) {
      return false;
    }
  }
  return true;
}

function hasNonWhitespace(bytes: Uint8Array): boolean {
  for (let index = 0; index < bytes.length; index++) {
    const byte = bytes[index];
    if (
      byte !== 32 && // space
      byte !== 9 && // \t
      byte !== NEWLINE &&
      byte !== 13 && // \r
      byte !== 12 && // \f
      byte !== 11 // \v
    ) {
      return true;
    }
  }
  return false;
}

function findGitFileBoundary(
  bytes: Uint8Array,
  end: number,
  from: number
): number | null {
  let lineStart = from;
  for (;;) {
    if (matchesAscii(bytes, lineStart, end, GIT_FILE_BOUNDARY)) {
      return lineStart;
    }
    const newlineIndex = bytes.indexOf(NEWLINE, lineStart);
    if (newlineIndex === -1 || newlineIndex >= end) {
      return null;
    }
    lineStart = newlineIndex + 1;
  }
}
