import { StringDecoder } from 'node:string_decoder';

/**
 * Reading a harness process's output: its stdout as whole lines (a line split across chunks is kept until its newline,
 * `\r\n` ends a line too, a character split across chunks stays whole), and the end of its stderr.
 */

export class LineReader {
  readonly #decoder = new StringDecoder('utf8');
  #partial = '';

  /** The whole lines a chunk completes, without their line ends. */
  push(chunk: Buffer | string): string[] {
    const text = this.#partial + (typeof chunk === 'string' ? chunk : this.#decoder.write(chunk));
    const lines = text.split('\n');
    this.#partial = lines.pop() as string;
    return lines.map(stripCr);
  }

  /** The last line, when the output ended without a newline; undefined when nothing is left. */
  end(): string | undefined {
    const rest = stripCr(this.#partial + this.#decoder.end());
    this.#partial = '';
    return rest === '' ? undefined : rest;
  }
}

const stripCr = (line: string) => (line.endsWith('\r') ? line.slice(0, -1) : line);

/** The longest end of stderr kept: what a failed turn's result quotes. */
export const STDERR_TAIL_BYTES = 4096;

/** The last `STDERR_TAIL_BYTES` of a stream, as text. */
export class TailBuffer {
  #bytes: Buffer = Buffer.alloc(0);

  push(chunk: Buffer | string): void {
    const next = Buffer.concat([this.#bytes, typeof chunk === 'string' ? Buffer.from(chunk) : chunk]);
    this.#bytes = next.length > STDERR_TAIL_BYTES ? next.subarray(next.length - STDERR_TAIL_BYTES) : next;
  }

  /** The kept end, decoded (a character cut at its start is replaced). */
  text(): string {
    return this.#bytes.toString('utf8');
  }
}
