/**
 * A harness's stdout journal read as lines (S5.4): the file the keeper appends to, read from a byte offset with one open
 * and one read per call (no process, no watcher), split on newline bytes (never inside a UTF-8 character), `\r\n`
 * ending a line too. Each line carries the offset just after it, so a runner that restarts knows where its reading
 * stopped; a line still being written waits for the next read.
 */

/** Reads at most `bytes` bytes of a file from `offset`: its bytes and its size, or undefined when it cannot be read. */
export type ReadAt = (
  path: string,
  offset: number,
  bytes: number,
) => { readonly data: Uint8Array; readonly size: number } | undefined;

/** How much one read takes at most; a read goes on until the file's end. */
export const JOURNAL_READ_BYTES = 1024 * 1024;

/** A whole line and the offset just after its newline. */
export interface JournalLine {
  readonly line: string;
  readonly end: number;
}

const NEWLINE = 0x0a;

const decode = (bytes: Uint8Array) => {
  const text = Buffer.from(bytes).toString('utf8');
  return text.endsWith('\r') ? text.slice(0, -1) : text;
};

export class JournalReader {
  readonly #path: string;
  readonly #readAt: ReadAt;
  /** Bytes read so far (whole lines and the partial one). */
  #read = 0;
  /** The partial line's bytes. */
  #partial: Uint8Array = new Uint8Array(0);

  constructor(path: string, readAt: ReadAt, from = 0) {
    this.#path = path;
    this.#readAt = readAt;
    this.#read = from;
  }

  /** How far the whole lines go: where a restarted reader starts. */
  get offset(): number {
    return this.#read - this.#partial.length;
  }

  /** The whole lines written since the last read, up to `limit` bytes into the file when given. */
  lines(limit = Number.POSITIVE_INFINITY): JournalLine[] {
    const lines: JournalLine[] = [];
    for (;;) {
      const want = Math.min(JOURNAL_READ_BYTES, limit - this.#read);
      if (want <= 0) break;
      const chunk = this.#readAt(this.#path, this.#read, want);
      if (chunk === undefined || chunk.data.length === 0) break;
      this.#take(chunk.data, lines);
      if (this.#read >= chunk.size) break;
    }
    return lines;
  }

  /** The last line when the output ended without a newline (once), undefined when nothing is left. */
  rest(): JournalLine | undefined {
    if (this.#partial.length === 0) return undefined;
    const line = decode(this.#partial);
    this.#partial = new Uint8Array(0);
    return line === '' ? undefined : { line, end: this.#read };
  }

  #take(data: Uint8Array, lines: JournalLine[]): void {
    const bytes = this.#partial.length === 0 ? data : Buffer.concat([this.#partial, data]);
    const base = this.#read - this.#partial.length;
    let start = 0;
    for (let at = bytes.indexOf(NEWLINE); at !== -1; at = bytes.indexOf(NEWLINE, start)) {
      lines.push({ line: decode(bytes.subarray(start, at)), end: base + at + 1 });
      start = at + 1;
    }
    this.#partial = bytes.subarray(start);
    this.#read += data.length;
  }
}
