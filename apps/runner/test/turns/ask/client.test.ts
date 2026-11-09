import { createServer, type Server, type Socket } from 'node:net';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { askRunner, NOT_IN_TURN } from '../../../src/turns/ask/client.ts';
import { QUESTION } from '../../fixtures/ask.ts';
import { tempDir } from '../../fixtures/runner.ts';

const servers: Server[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.close();
});

/** A socket that does what the test says with each connection, and the lines it got. */
async function socketDoing(behaviour: (socket: Socket, line: string) => void) {
  const path = join(tempDir(), 's.sock');
  const lines: string[] = [];
  const server = createServer((socket) => {
    socket.once('data', (chunk: Buffer) => {
      const line = chunk.toString().trimEnd();
      lines.push(line);
      behaviour(socket, line);
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(path, resolve));
  return { path, lines };
}

describe("the MCP server's call to the runner", () => {
  it('sends the token and the questions as one line and reads the answer line', async () => {
    const socket = await socketDoing((s) => s.end(`${JSON.stringify({ ok: true, text: 'shown' })}\n`));
    expect(await askRunner(socket.path, 'tok', [QUESTION])).toEqual({ ok: true, text: 'shown' });
    expect(socket.lines.map((line) => JSON.parse(line))).toEqual([{ token: 'tok', questions: [QUESTION] }]);
  });

  it('says the turn is not reachable when there is no socket, it closes or it answers nothing in time', async () => {
    expect(await askRunner(join(tempDir(), 'gone.sock'), 'tok', [QUESTION])).toEqual({
      ok: false,
      error: NOT_IN_TURN,
    });
    const closing = await socketDoing((s) => s.end());
    expect(await askRunner(closing.path, 'tok', [QUESTION])).toEqual({ ok: false, error: NOT_IN_TURN });
    const silent = await socketDoing(() => undefined);
    expect(await askRunner(silent.path, 'tok', [QUESTION], 50)).toEqual({
      ok: false,
      error: `${NOT_IN_TURN} (no answer in time)`,
    });
  });

  it('says so when the answer is not one it can read, or too long', async () => {
    for (const text of ['nope\n', '{"ok":"yes"}\n']) {
      const socket = await socketDoing((s) => s.end(text));
      expect(await askRunner(socket.path, 'tok', [QUESTION])).toEqual({
        ok: false,
        error: `${NOT_IN_TURN} (an answer it could not read)`,
      });
    }
    const long = await socketDoing((s) => s.write('x'.repeat(70 * 1024)));
    expect(await askRunner(long.path, 'tok', [QUESTION])).toEqual({
      ok: false,
      error: `${NOT_IN_TURN} (an answer too long)`,
    });
  });
});
