import { describe, expect, test } from 'bun:test';

import { LineList } from '../src/utils/LineList';

// Round-tripping a sealed `LineList` must reproduce the input exactly: `seal()`
// compacts the lines into a UTF-8 byte arena, and `get()`/iteration decode them
// back on demand. These cases pin the encodings a byte arena can get subtly
// wrong (a leading BOM, multi-byte and astral characters, lone surrogates) so
// the sealed model stays byte-identical to the plain `string[]`
function expectRoundTrip(lines: string[]): void {
  const list = LineList.sealed(lines);
  expect(list.length).toBe(lines.length);
  for (let i = 0; i < lines.length; i++) {
    expect(list.get(i)).toBe(lines[i]);
  }
  expect([...list]).toEqual(lines);
  expect(list.join('')).toBe(lines.join(''));
}

describe('LineList seal round-trip', () => {
  test('pure ASCII', () => {
    expectRoundTrip(['hello\n', 'world\n', 'last line, no newline']);
  });

  test('empty list and empty lines', () => {
    expectRoundTrip([]);
    expectRoundTrip(['']);
    expectRoundTrip(['\n', '', 'x\n']);
  });

  test('multi-byte content keeps per-line offsets aligned', () => {
    expectRoundTrip(['café\n', 'naïve\n', 'résumé\n', 'plain ascii\n']);
    expectRoundTrip(['日本語\n', 'emoji 😀 mixed\n', 'tail 🎉']);
  });

  test('a line that starts with a BOM (U+FEFF) is preserved', () => {
    // Regression: the decoder must use `{ ignoreBOM: true }`, otherwise a
    // leading U+FEFF is silently stripped when the arena is decoded back
    const list = LineList.sealed(['﻿import x\n', 'const y = 1\n']);
    expect(list.get(0)).toBe('﻿import x\n');
    expect(list.get(1)).toBe('const y = 1\n');
    expect(list.get(0).charCodeAt(0)).toBe(0xfeff);
  });

  test('valid astral characters (surrogate pairs) round-trip', () => {
    expectRoundTrip(['a😀b\n', '𝕳𝖊𝖑𝖑𝖔\n']);
  });

  test('a lone surrogate keeps the content byte-exact', () => {
    // UTF-8 can't represent a lone surrogate, so `seal()` must keep the plain
    // `string[]` rather than silently turning it into U+FFFD
    const lossy = ['ok line\n', 'broken \uD800 high surrogate\n'];
    const list = LineList.sealed(lossy);
    expect(list.get(0)).toBe(lossy[0]);
    expect(list.get(1)).toBe(lossy[1]);
    expect(list.get(1).includes('\uD800')).toBe(true);
  });

  test('genuine U+FFFD content still round-trips (false-positive guard)', () => {
    expectRoundTrip(['has a � replacement char\n', 'next\n']);
  });

  test('mutating a sealed list rebuilds it transparently', () => {
    const list = LineList.sealed(['café\n', 'two\n']);
    list.set(0, 'changed é\n');
    list.push('three\n');
    expect(list.length).toBe(3);
    expect(list.get(0)).toBe('changed é\n');
    expect(list.get(1)).toBe('two\n');
    expect(list.get(2)).toBe('three\n');
  });

  test('revive() restores a list that crossed a postMessage boundary', () => {
    // `structuredClone` reproduces what `postMessage` does to a worker: it keeps
    // the byte arena but drops the class prototype, so the clone has no `get()`
    // until `revive()` rebuilds it. This is the highlight-worker path that
    // bun:test can't exercise with a real Worker
    const cloned = structuredClone(LineList.sealed(['café\n', '日本語\n']));
    expect(cloned instanceof LineList).toBe(false);
    const revived = LineList.revive(cloned);
    expect(revived.get(0)).toBe('café\n');
    expect(revived.get(1)).toBe('日本語\n');
  });
});
