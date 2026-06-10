import { describe, expect, spyOn, test } from 'bun:test';

import { type DiffLines, lineAt, linesToArray } from '../src/utils/diffLines';
import { processFileBytes } from '../src/utils/parsePatchBytes';
import { processFile } from '../src/utils/parsePatchFiles';
import {
  diffPatch,
  finalBlankLinePatch,
  formatPatchWithVersionTrailer,
  malformedPatch,
} from './mocks';

const encoder = new TextEncoder();

// Replace each side's DiffLines with the equivalent string[] so models from
// the two parsers can be compared with toEqual regardless of the offsets
// table width each one picked
function withComparableLines(file: ReturnType<typeof processFile>) {
  if (file == null) {
    return file;
  }
  return {
    ...file,
    additionLines: linesToArray(file.additionLines),
    deletionLines: linesToArray(file.deletionLines),
  };
}

// Split a multi-file patch at `diff --git` line starts, the same boundaries
// the streaming pipeline feeds to processFile/processFileBytes
function splitPatchFiles(patch: string): string[] {
  const parts: string[] = [];
  let start = 0;
  for (;;) {
    const next = patch.indexOf('\ndiff --git ', start);
    if (next === -1) {
      break;
    }
    if (next + 1 > start) {
      parts.push(patch.slice(start, next + 1));
    }
    start = next + 1;
  }
  parts.push(patch.slice(start));
  return parts.filter((part) => /\S/.test(part));
}

function expectSameModel(fileText: string): void {
  const fromString = processFile(fileText, { isGitDiff: true });
  const fromBytes = processFileBytes(encoder.encode(fileText), {
    isGitDiff: true,
  });
  expect(withComparableLines(fromBytes)).toEqual(
    withComparableLines(fromString)
  );
}

function arena(lines: DiffLines) {
  if ('lines' in lines) {
    throw new Error('expected an arena DiffLines, got the string fallback');
  }
  return lines;
}

describe('processFileBytes', () => {
  test('matches processFile on every file of the mock pr patch', () => {
    for (const fileText of splitPatchFiles(diffPatch)) {
      expectSameModel(fileText);
    }
  });

  test('matches processFile on a unified (non-git) patch', () => {
    const fromString = processFile(finalBlankLinePatch);
    const fromBytes = processFileBytes(encoder.encode(finalBlankLinePatch));
    expect(withComparableLines(fromBytes)).toEqual(
      withComparableLines(fromString)
    );
  });

  test('matches processFile on a format-patch file with version trailer', () => {
    const consoleError = spyOn(console, 'error').mockImplementation(() => {});
    try {
      for (const fileText of splitPatchFiles(formatPatchWithVersionTrailer)) {
        expectSameModel(fileText);
      }
      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });

  test('matches processFile on a malformed patch, warnings included', () => {
    const consoleError = spyOn(console, 'error').mockImplementation(() => {});
    try {
      const fromString = processFile(malformedPatch, { isGitDiff: true });
      const stringErrorCalls = consoleError.mock.calls.length;
      expect(stringErrorCalls).toBeGreaterThan(0);

      const fromBytes = processFileBytes(encoder.encode(malformedPatch), {
        isGitDiff: true,
      });
      expect(consoleError.mock.calls.length).toBe(stringErrorCalls * 2);
      expect(withComparableLines(fromBytes)).toEqual(
        withComparableLines(fromString)
      );
    } finally {
      consoleError.mockRestore();
    }
  });

  test('matches processFile on CRLF content and no-newline markers', () => {
    const fileText = [
      'diff --git a/crlf.txt b/crlf.txt\r\n',
      'index 1111111..2222222 100644\r\n',
      '--- a/crlf.txt\r\n',
      '+++ b/crlf.txt\r\n',
      '@@ -1,2 +1,2 @@ some context\r\n',
      ' first\r\n',
      '-old last\r\n',
      '+new last\r\n',
      '\\ No newline at end of file\r\n',
    ].join('');
    expectSameModel(fileText);

    const fromBytes = processFileBytes(encoder.encode(fileText), {
      isGitDiff: true,
    });
    expect(lineAt(fromBytes!.additionLines, 1)).toBe('new last');
    expect(fromBytes!.hunks[0].noEOFCRAdditions).toBe(true);
    expect(fromBytes!.hunks[0].hunkContext).toBe('some context');
  });

  test('matches processFile on a header-only pure rename', () => {
    const fileText = [
      'diff --git a/old/name.ts b/new/name.ts\n',
      'similarity index 100%\n',
      'rename from old/name.ts\n',
      'rename to new/name.ts\n',
    ].join('');
    expectSameModel(fileText);

    const fromBytes = processFileBytes(encoder.encode(fileText), {
      isGitDiff: true,
    });
    expect(fromBytes!.type).toBe('rename-pure');
    expect(fromBytes!.name).toBe('new/name.ts');
    expect(fromBytes!.prevName).toBe('old/name.ts');
  });

  test('matches processFile on empty input', () => {
    expectSameModel('');
  });

  test('passes cacheKey through like processFile', () => {
    const fileText = [
      'diff --git a/a.txt b/a.txt\n',
      '--- a/a.txt\n',
      '+++ b/a.txt\n',
      '@@ -1 +1 @@\n',
      '-x\n',
      '+y\n',
    ].join('');
    const fromBytes = processFileBytes(encoder.encode(fileText), {
      isGitDiff: true,
      cacheKey: 'patch-0-3',
    });
    expect(fromBytes!.cacheKey).toBe('patch-0-3');
  });

  test('preserves invalid UTF-8 bytes and decodes them like the string path', () => {
    const head = encoder.encode(
      [
        'diff --git a/bin.txt b/bin.txt\n',
        '--- a/bin.txt\n',
        '+++ b/bin.txt\n',
        '@@ -0,0 +1 @@\n',
        '+ab',
      ].join('')
    );
    // 0xff 0xfe is not valid UTF-8; the string pipeline would have decoded
    // these bytes to U+FFFD before parsing, and decoding the stored arena
    // bytes on read produces the same replacement characters
    const fileBytes = new Uint8Array(head.length + 3);
    fileBytes.set(head);
    fileBytes[head.length] = 0xff;
    fileBytes[head.length + 1] = 0xfe;
    fileBytes[head.length + 2] = 0x0a;

    const fromBytes = processFileBytes(fileBytes, { isGitDiff: true });
    expect(lineAt(fromBytes!.additionLines, 0)).toBe('ab��\n');

    const decoded = new TextDecoder().decode(fileBytes);
    const fromString = processFile(decoded, { isGitDiff: true });
    expect(lineAt(fromString!.additionLines, 0)).toBe('ab��\n');
  });

  test('keeps multi-byte characters and emoji intact in the arena', () => {
    const fileText = [
      'diff --git a/unicode.txt b/unicode.txt\n',
      '--- a/unicode.txt\n',
      '+++ b/unicode.txt\n',
      '@@ -1 +1,2 @@\n',
      '-héllo wörld\n',
      '+héllo wörld 🎉\n',
      '+﻿bom line\n',
    ].join('');
    expectSameModel(fileText);

    const fromBytes = processFileBytes(encoder.encode(fileText), {
      isGitDiff: true,
    });
    expect(lineAt(fromBytes!.additionLines, 0)).toBe('héllo wörld 🎉\n');
    expect(lineAt(fromBytes!.additionLines, 1)).toBe('﻿bom line\n');
  });

  test('always produces the byte arena (no string fallback exists)', () => {
    const fileText = [
      'diff --git a/a.txt b/a.txt\n',
      '--- a/a.txt\n',
      '+++ b/a.txt\n',
      '@@ -1 +1 @@\n',
      '-x\n',
      '+y\n',
    ].join('');
    const fromBytes = processFileBytes(encoder.encode(fileText), {
      isGitDiff: true,
    });
    expect(arena(fromBytes!.additionLines).bytes).toBeInstanceOf(Uint8Array);
    expect(arena(fromBytes!.deletionLines).bytes).toBeInstanceOf(Uint8Array);
  });

  test('detects a git diff from the bytes when isGitDiff is not passed', () => {
    const fileText = [
      'diff --git a/detect.txt b/detect.txt\n',
      'index 1111111..2222222 100644\n',
      '--- a/detect.txt\n',
      '+++ b/detect.txt\n',
      '@@ -1 +1 @@\n',
      '-x\n',
      '+y\n',
    ].join('');
    const fromBytes = processFileBytes(encoder.encode(fileText));
    expect(fromBytes!.name).toBe('detect.txt');
    expect(fromBytes!.prevObjectId).toBe('1111111');
  });

  test('reuses the side builders without leaking state across calls', () => {
    const first = [
      'diff --git a/first.txt b/first.txt\n',
      '--- a/first.txt\n',
      '+++ b/first.txt\n',
      '@@ -1,2 +1,2 @@\n',
      ' shared\n',
      '-aaaa\n',
      '+bbbb\n',
    ].join('');
    const second = [
      'diff --git a/second.txt b/second.txt\n',
      '--- a/second.txt\n',
      '+++ b/second.txt\n',
      '@@ -1 +1 @@\n',
      '-c\n',
      '+d\n',
    ].join('');
    const firstModel = processFileBytes(encoder.encode(first), {
      isGitDiff: true,
    });
    const secondModel = processFileBytes(encoder.encode(second), {
      isGitDiff: true,
    });
    expect(linesToArray(firstModel!.additionLines)).toEqual([
      'shared\n',
      'bbbb\n',
    ]);
    expect(linesToArray(secondModel!.additionLines)).toEqual(['d\n']);
    expect(linesToArray(secondModel!.deletionLines)).toEqual(['c\n']);
  });
});
