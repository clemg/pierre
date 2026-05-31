/**
 * An ordered list of diff line strings with two internal representations:
 *
 *  - "building": a plain `string[]` you can `push`/`set`/`clear`, used while a
 *    file is being parsed or a region/merge result is assembled.
 *  - "sealed": one UTF-8 byte arena (`Uint8Array`) holding every line's content
 *    concatenated, plus an `Int32Array` of cumulative byte offsets. A line is
 *    rebuilt lazily as `decode(bytes.subarray(offsets[i], offsets[i + 1]))`.
 *
 * Why bytes and not a string arena: on a huge diff the parser keeps one line
 * string per added/deleted/context line, tens of millions of tiny `String`
 * objects, each a slice that pins its file's backing text. Collapsing them
 * helps, but a character arena is stored as UTF-16 (2 bytes/char) the moment a
 * file contains a single non-ASCII character, which doubles the content and
 * cancels the win. UTF-8 bytes keep ASCII at 1 byte/char, never taint a whole
 * file to 2 bytes, and live off the V8 heap (in the `Uint8Array` backing
 * store), so both real RSS and the V8 heap drop. Lines decode on demand, which
 * is cheap because only the (virtualized) visible lines are ever read back.
 *
 * Reads (`length`/`get`/iteration/`join`) work in either mode. A write after
 * sealing transparently rebuilds the building array, so a later mutation of a
 * sealed list is still correct, it just loses the memory win for that one list
 */
const encoder = new TextEncoder();
// `ignoreBOM` is required: without it the decoder silently strips a leading
// U+FEFF, so a line that genuinely starts with a BOM loses that character on
// read (same reason `detachString` uses it)
const decoder = new TextDecoder('utf-8', { ignoreBOM: true });

// One scratch buffer reused for every file's encode, so sealing doesn't
// allocate a fresh (up to 3x content) transient per file. Released after a
// parse run via `releaseSealBuffer` so one huge file doesn't pin the peak
const SEAL_SCRATCH_INITIAL = 1024;
let sealScratch = new Uint8Array(SEAL_SCRATCH_INITIAL);

// Drop the scratch buffer back to its initial size after a parse run
export function releaseSealBuffer(): void {
  if (sealScratch.length !== SEAL_SCRATCH_INITIAL) {
    sealScratch = new Uint8Array(SEAL_SCRATCH_INITIAL);
  }
}

export class LineList {
  private building: string[] | null;
  private bytes: Uint8Array | null = null;
  private offsets: Int32Array | null = null;
  private size: number;

  constructor(initial: string[] = []) {
    this.building = initial;
    this.size = initial.length;
  }

  /** Build from a known-complete array and seal it immediately */
  static sealed(initial: string[]): LineList {
    const list = new LineList(initial);
    list.seal();
    return list;
  }

  /**
   * Rebuild a `LineList` from the plain object a structured clone produces, e.g.
   * a diff sent to the highlight worker via `postMessage`. Structured clone
   * copies the byte arena, offset table, and size but drops the class prototype,
   * so the worker would otherwise get a method-less object and `get()` would
   * throw. Wraps a fresh `LineList` around the same data (no line content is
   * copied or re-decoded), and is idempotent for values already a `LineList`
   */
  static revive(value: LineList): LineList {
    // Already a working instance (e.g. the main-thread render path), no-op
    if (value instanceof LineList) {
      return value;
    }
    // The `instanceof` check narrows `value` to `never` here, so cast through
    // `unknown` to read the cloned fields off the prototype-less plain object
    const clone = value as unknown as LineList;
    const list = new LineList();
    list.building = clone.building;
    list.bytes = clone.bytes;
    list.offsets = clone.offsets;
    list.size = clone.size;
    return list;
  }

  get length(): number {
    return this.size;
  }

  get(index: number): string {
    // Match plain-array semantics: out-of-range reads are `undefined`, which
    // callers guard with `== null`
    if (index < 0 || index >= this.size) {
      return undefined as unknown as string;
    }
    const building = this.building;
    if (building !== null) {
      return building[index];
    }
    return decoder.decode(
      this.bytes!.subarray(this.offsets![index], this.offsets![index + 1])
    );
  }

  set(index: number, value: string): void {
    this.toBuilding()[index] = value;
  }

  push(value: string): void {
    const building = this.toBuilding();
    building.push(value);
    this.size = building.length;
  }

  clear(): void {
    this.toBuilding().length = 0;
    this.size = 0;
  }

  join(separator = ''): string {
    if (this.building !== null) {
      return this.building.join(separator);
    }
    // The byte arena is already every line concatenated with no separator
    if (separator === '') {
      return decoder.decode(this.bytes!);
    }
    let out = '';
    for (let i = 0; i < this.size; i++) {
      if (i > 0) {
        out += separator;
      }
      out += this.get(i);
    }
    return out;
  }

  /** Materialize a plain `string[]` for a sub-range (mainly for tests/interop) */
  slice(start = 0, end = this.size): string[] {
    const from = start < 0 ? Math.max(this.size + start, 0) : start;
    const to = end < 0 ? this.size + end : Math.min(end, this.size);
    const out: string[] = [];
    for (let i = from; i < to; i++) {
      out.push(this.get(i));
    }
    return out;
  }

  *[Symbol.iterator](): IterableIterator<string> {
    for (let i = 0; i < this.size; i++) {
      yield this.get(i);
    }
  }

  // Serialize as the plain line array (for `JSON.stringify` and snapshot output)
  // so callers and tests see line content, not the byte-arena internals
  toJSON(): string[] {
    return this.slice();
  }

  /**
   * Collapse the building array into the compact UTF-8 byte arena + offset
   * table. No-op if already sealed. Call once a file's lines are final
   */
  seal(): void {
    const building = this.building;
    if (building === null) {
      return;
    }
    // Size the scratch to the safe UTF-8 upper bound (<= 3 bytes per UTF-16 code
    // unit) so a single encode can never overflow it
    let charTotal = 0;
    for (let i = 0; i < building.length; i++) {
      charTotal += building[i].length;
    }
    const required = charTotal * 3 + 8;
    if (sealScratch.length < required) {
      sealScratch = new Uint8Array(required);
    }
    const offsets = new Int32Array(building.length + 1);
    // Encode the whole file in one call, then split it into per-line offsets
    // without re-encoding. When every UTF-16 code unit produced exactly one byte
    // (written === charTotal) the file is pure ASCII, so a line's byte offset is
    // just its cumulative char length. Otherwise walk the encoded bytes by UTF-8
    // sequence, counting the UTF-16 code units each represents, to find where
    // each line (of known char length) ends: a cheap read-only pass instead of a
    // second encode
    const joined = building.join('');
    const { written } = encoder.encodeInto(joined, sealScratch);
    let position = written;
    // The only content a UTF-8 arena can't reproduce is a lone surrogate, which
    // `encodeInto` rewrites as U+FFFD (bytes ef bf bd). We notice that byte
    // pattern while walking the arena below and only then run the precise
    // round-trip check, so the common lossless file never pays for it
    let maybeLossy = false;
    if (written === charTotal) {
      let charPos = 0;
      for (let i = 0; i < building.length; i++) {
        charPos += building[i].length;
        offsets[i + 1] = charPos;
      }
    } else {
      let bytePos = 0;
      let charCount = 0;
      let target = 0;
      let straddled = false;
      for (let i = 0; i < building.length; i++) {
        target += building[i].length;
        while (charCount < target) {
          const lead = sealScratch[bytePos];
          if (lead < 0x80) {
            bytePos += 1;
            charCount += 1;
          } else if (lead < 0xe0) {
            bytePos += 2;
            charCount += 1;
          } else if (lead < 0xf0) {
            if (
              lead === 0xef &&
              sealScratch[bytePos + 1] === 0xbf &&
              sealScratch[bytePos + 2] === 0xbd
            ) {
              maybeLossy = true;
            }
            bytePos += 3;
            charCount += 1;
          } else {
            // A 4-byte sequence is one astral code point = two UTF-16 units
            bytePos += 4;
            charCount += 2;
          }
        }
        if (charCount !== target) {
          // A code point straddles this line boundary, only possible if a caller
          // split a surrogate pair across two lines. Re-encode per line so each
          // line's bytes stay exact; that split is lossy, so force the round-trip
          // check to keep the plain array
          straddled = true;
          break;
        }
        offsets[i + 1] = bytePos;
      }
      if (straddled) {
        maybeLossy = true;
        position = 0;
        for (let i = 0; i < building.length; i++) {
          const { written: lineBytes } = encoder.encodeInto(
            building[i],
            sealScratch.subarray(position)
          );
          position += lineBytes;
          offsets[i + 1] = position;
        }
      }
    }
    const bytes = sealScratch.slice(0, position);
    // U+FFFD can also be genuine content (a false positive here is harmless, it
    // just costs one comparison). When the round-trip actually differs we keep
    // the plain `string[]` so the lost surrogate's content stays byte-exact
    if (maybeLossy && decoder.decode(bytes) !== joined) {
      return;
    }
    this.bytes = bytes;
    this.offsets = offsets;
    this.size = building.length;
    this.building = null;
  }

  // Restore (or keep) the building array. Only the rare path that mutates an
  // already-sealed list pays the rebuild cost
  private toBuilding(): string[] {
    if (this.building !== null) {
      return this.building;
    }
    const building = new Array<string>(this.size);
    for (let i = 0; i < this.size; i++) {
      building[i] = decoder.decode(
        this.bytes!.subarray(this.offsets![i], this.offsets![i + 1])
      );
    }
    this.building = building;
    this.bytes = null;
    this.offsets = null;
    return building;
  }
}
