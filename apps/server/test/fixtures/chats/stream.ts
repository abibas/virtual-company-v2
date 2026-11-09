/**
 * The chat stream tests' reader: `GET …/stream` through the app (a real `Response` whose body the test reads), its
 * Server-Sent Events parsed as they come (`event`, `id`, `data` and comments), and a wait for the next one that matches.
 */
import type { App } from '@mwc/testkit';
import { eventually } from '../platform/realtime.ts';

/** One Server-Sent Event, or a comment line. */
export interface SseMessage {
  readonly event?: string;
  readonly id?: string;
  readonly data?: unknown;
  readonly comment?: string;
}

export interface OpenStream {
  readonly status: number;
  readonly contentType: string | null;
  readonly messages: SseMessage[];
  /** Waits for `count` messages that match (2 s at most). */
  until(what: string, check: (messages: SseMessage[]) => boolean): Promise<void>;
  close(): Promise<void>;
}

/** Reads one SSE block (`event:`, `id:`, `data:` lines, or `: comment`). */
function parseBlock(block: string): SseMessage | undefined {
  const message: { event?: string; id?: string; data?: unknown; comment?: string } = {};
  for (const line of block.split('\n')) {
    if (line.startsWith(':')) message.comment = line.slice(1).trim();
    else if (line.startsWith('event:')) message.event = line.slice(6).trim();
    else if (line.startsWith('id:')) message.id = line.slice(3).trim();
    else if (line.startsWith('data:')) message.data = JSON.parse(line.slice(5).trim());
  }
  return Object.keys(message).length === 0 ? undefined : message;
}

/** Opens the stream at `path` with these headers and reads it in the background until `close`. */
export async function openStream(
  app: App,
  path: string,
  headers: Record<string, string>,
): Promise<OpenStream> {
  const res = await app.request(path, { headers });
  const messages: SseMessage[] = [];
  const reader = res.body?.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const pump = (async () => {
    if (reader === undefined || res.status !== 200) return;
    for (;;) {
      const { value, done } = await reader.read().catch(() => ({ value: undefined, done: true }));
      if (done) return;
      buffer += decoder.decode(value, { stream: true });
      let end = buffer.indexOf('\n\n');
      while (end !== -1) {
        const parsed = parseBlock(buffer.slice(0, end));
        if (parsed) messages.push(parsed);
        buffer = buffer.slice(end + 2);
        end = buffer.indexOf('\n\n');
      }
    }
  })();
  return {
    status: res.status,
    contentType: res.headers.get('content-type'),
    messages,
    until: (what, check) => eventually(what, () => check(messages)),
    async close() {
      await reader?.cancel().catch(() => undefined);
      await pump;
    },
  };
}
