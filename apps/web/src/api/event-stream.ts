/**
 * Reading Server-Sent Events from a `fetch` body (the chat's stream, S5.1c): `fetch` carries the Bearer header, which
 * `EventSource` cannot. Messages are split on blank lines; `event:`, `data:` (several joined by newlines) and `id:` are
 * kept, a comment line (`: heartbeat`) only proves the stream is alive. Pure but for the reader it is given.
 */

export interface StreamMessage {
  readonly event: string;
  readonly data: string;
  readonly id: string | undefined;
}

/** How long a stream may stay silent before it counts as dropped: the server comments every 20 s. */
export const STREAM_SILENCE_MS = 50_000;

/** One message's lines as a message; undefined for a comment-only block or one without data. */
export function parseBlock(block: string): StreamMessage | undefined {
  let event = 'message';
  let id: string | undefined;
  const data: string[] = [];
  for (const line of block.split('\n')) {
    if (line === '' || line.startsWith(':')) continue;
    const colon = line.indexOf(':');
    const field = colon < 0 ? line : line.slice(0, colon);
    const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '');
    if (field === 'event') event = value;
    else if (field === 'data') data.push(value);
    else if (field === 'id') id = value;
  }
  return data.length === 0 ? undefined : { event, data: data.join('\n'), id };
}

/**
 * Reads `body` to its end, calling `onMessage` for each message and `onAlive` for every chunk (heartbeats included).
 * A stream silent for `STREAM_SILENCE_MS` is cancelled, so the caller reconnects; the promise resolves when the stream
 * ends either way and rejects only when the read fails (a dropped connection, an abort).
 */
export async function readEventStream(
  body: ReadableStream<Uint8Array>,
  onMessage: (message: StreamMessage) => void,
  onAlive: () => void = () => undefined,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let silence: ReturnType<typeof setTimeout> | undefined;
  const watch = () => {
    clearTimeout(silence);
    silence = setTimeout(() => void reader.cancel().catch(() => undefined), STREAM_SILENCE_MS);
  };
  watch();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      watch();
      onAlive();
      buffer += decoder.decode(value, { stream: true }).replace(/\r/g, '');
      let end = buffer.indexOf('\n\n');
      while (end >= 0) {
        const message = parseBlock(buffer.slice(0, end));
        buffer = buffer.slice(end + 2);
        if (message) onMessage(message);
        end = buffer.indexOf('\n\n');
      }
    }
  } finally {
    clearTimeout(silence);
    reader.releaseLock();
  }
}
