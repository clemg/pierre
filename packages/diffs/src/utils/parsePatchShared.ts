import {
  ALTERNATE_FILE_NAMES_GIT,
  FILENAME_HEADER_REGEX,
  FILENAME_HEADER_REGEX_GIT,
  INDEX_LINE_METADATA,
} from '../constants';
import type { ChangeContent, ContextContent, FileDiffMetadata } from '../types';
import { detachString } from './detachString';

// Parsing internals shared between the string parser (parsePatchFiles) and the
// byte parser (parsePatchBytes). This module is intentionally NOT re-exported
// from the package index: both parsers must interpret patch metadata the exact
// same way, so the logic lives here once, but none of it is public API

export interface ParsedHunkHeader {
  additionCount: number;
  additionStart: number;
  deletionCount: number;
  deletionStart: number;
  hunkContext?: string;
}

// Read one `@@ -a,b +c,d @@ context` hunk header line. Returns undefined when
// the line is not a valid hunk header so callers can treat the chunk as
// malformed input
export function parseHunkHeader(line: string): ParsedHunkHeader | undefined {
  if (!line.startsWith('@@ -')) {
    return undefined;
  }

  let index = 4;
  const deletionStartResult = readPositiveInteger(line, index);
  if (deletionStartResult == null) {
    return undefined;
  }
  const deletionStart = deletionStartResult.value;
  index = deletionStartResult.endIndex;

  let deletionCount = 1;
  if (line[index] === ',') {
    const deletionCountResult = readPositiveInteger(line, index + 1);
    if (deletionCountResult == null) {
      return undefined;
    }
    deletionCount = deletionCountResult.value;
    index = deletionCountResult.endIndex;
  }

  if (line[index] !== ' ' || line[index + 1] !== '+') {
    return undefined;
  }
  index += 2;

  const additionStartResult = readPositiveInteger(line, index);
  if (additionStartResult == null) {
    return undefined;
  }
  const additionStart = additionStartResult.value;
  index = additionStartResult.endIndex;

  let additionCount = 1;
  if (line[index] === ',') {
    const additionCountResult = readPositiveInteger(line, index + 1);
    if (additionCountResult == null) {
      return undefined;
    }
    additionCount = additionCountResult.value;
    index = additionCountResult.endIndex;
  }

  if (
    line[index] !== ' ' ||
    line[index + 1] !== '@' ||
    line[index + 2] !== '@'
  ) {
    return undefined;
  }

  let hunkContext: string | undefined;
  const contextStartIndex = index + 3;
  if (line[contextStartIndex] === ' ') {
    hunkContext = trimLineEnd(line.slice(contextStartIndex + 1));
  }

  return {
    additionCount,
    additionStart,
    deletionCount,
    deletionStart,
    hunkContext,
  };
}

function readPositiveInteger(
  value: string,
  startIndex: number
): { value: number; endIndex: number } | undefined {
  let index = startIndex;
  let parsedValue = 0;
  for (; index < value.length; index++) {
    const digit = value.charCodeAt(index) - 48;
    if (digit < 0 || digit > 9) {
      break;
    }
    parsedValue = parsedValue * 10 + digit;
  }

  if (index === startIndex) {
    return undefined;
  }
  return { value: parsedValue, endIndex: index };
}

function trimLineEnd(value: string): string {
  if (value.endsWith('\r\n')) {
    return value.slice(0, -2);
  }
  if (value.endsWith('\n')) {
    return value.slice(0, -1);
  }
  return value;
}

// Apply one line of a file diff's header section (everything before the
// first hunk) to the file's metadata: names from `diff --git`/`---`/`+++`
// lines and, for git diffs, modes, object ids, and renames
export function applyFileHeaderLine(
  currentFile: FileDiffMetadata,
  line: string,
  isGitDiff: boolean,
  throwOnError: boolean
): void {
  if (line.startsWith('diff --git')) {
    const filenameMatch = line.trim().match(ALTERNATE_FILE_NAMES_GIT);
    const prevName = filenameMatch?.[1] ?? filenameMatch?.[2];
    const name = filenameMatch?.[3] ?? filenameMatch?.[4];
    if (prevName == null || name == null) {
      if (throwOnError) {
        throw Error('parsePatchContent: invalid git diff header');
      } else {
        console.error('parsePatchContent: invalid git diff header', line);
      }
      return;
    }
    currentFile.name = detachString(name.trim());
    if (prevName !== name) {
      currentFile.prevName = detachString(prevName.trim());
    }
    return;
  }

  const filenameMatch =
    line.startsWith('---') || line.startsWith('+++')
      ? line.match(
          isGitDiff ? FILENAME_HEADER_REGEX_GIT : FILENAME_HEADER_REGEX
        )
      : null;
  if (filenameMatch != null) {
    const [, type, fileName] = filenameMatch;
    if (type === '---' && fileName !== '/dev/null') {
      const detachedFileName = detachString(fileName.trim());
      currentFile.prevName = detachedFileName;
      currentFile.name = detachedFileName;
    } else if (type === '+++' && fileName !== '/dev/null') {
      currentFile.name = detachString(fileName.trim());
    }
  }
  // Git diffs have a bunch of additional metadata we can pull from
  else if (isGitDiff) {
    if (line.startsWith('new mode ')) {
      currentFile.mode = detachString(line.slice('new mode'.length).trim());
    }
    if (line.startsWith('old mode ')) {
      currentFile.prevMode = detachString(line.slice('old mode'.length).trim());
    }
    if (line.startsWith('new file mode')) {
      currentFile.type = 'new';
      currentFile.mode = detachString(
        line.slice('new file mode'.length).trim()
      );
    }
    if (line.startsWith('deleted file mode')) {
      currentFile.type = 'deleted';
      currentFile.mode = detachString(
        line.slice('deleted file mode'.length).trim()
      );
    }
    if (line.startsWith('similarity index')) {
      if (line.startsWith('similarity index 100%')) {
        currentFile.type = 'rename-pure';
      } else {
        currentFile.type = 'rename-changed';
      }
    }
    if (line.startsWith('index ')) {
      const [, prevObjectId, newObjectId, mode] =
        line.trim().match(INDEX_LINE_METADATA) ?? [];
      if (prevObjectId != null) {
        currentFile.prevObjectId = detachString(prevObjectId);
      }
      if (newObjectId != null) {
        currentFile.newObjectId = detachString(newObjectId);
      }
      if (mode != null) {
        currentFile.mode = detachString(mode);
      }
    }
    // We have to handle these for pure renames because there won't be
    // --- and +++ lines
    if (line.startsWith('rename from ')) {
      currentFile.prevName = detachString(
        line.slice('rename from '.length).trim()
      );
    }
    if (line.startsWith('rename to ')) {
      currentFile.name = detachString(line.slice('rename to '.length).trim());
    }
  }
}

export function splitWithNewlines(contents: string): string[] {
  if (contents.length === 0) {
    return [''];
  }

  const lines: string[] = [];
  let startIndex = 0;
  for (;;) {
    const newlineIndex = contents.indexOf('\n', startIndex);
    if (newlineIndex === -1) {
      break;
    }

    lines.push(contents.slice(startIndex, newlineIndex + 1));
    startIndex = newlineIndex + 1;
  }

  if (startIndex < contents.length) {
    lines.push(contents.slice(startIndex));
  }
  return lines;
}

export function maybeDetachOptionalString<T extends string | undefined>(
  value: T
): T {
  return (value == null ? value : detachString(value)) as T;
}

export function createContentGroup(
  type: 'change',
  deletionLineIndex: number,
  additionLineIndex: number
): ChangeContent;
export function createContentGroup(
  type: 'context',
  deletionLineIndex: number,
  additionLineIndex: number
): ContextContent;
export function createContentGroup(
  type: 'change' | 'context',
  deletionLineIndex: number,
  additionLineIndex: number
): ChangeContent | ContextContent {
  if (type === 'change') {
    return {
      type: 'change',
      additions: 0,
      deletions: 0,
      additionLineIndex,
      deletionLineIndex,
    };
  }
  return {
    type: 'context',
    lines: 0,
    additionLineIndex,
    deletionLineIndex,
  };
}
