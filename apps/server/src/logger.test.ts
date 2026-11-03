import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createLogger } from './logger.ts';

function sink() {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      chunks.push(chunk.toString());
      callback();
    },
  });
  return { stream, text: () => chunks.join('') };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('createLogger', () => {
  it('writes JSON lines at the configured level outside development', async () => {
    const out = sink();
    const logger = await createLogger(
      { NODE_ENV: 'production', MWC_LOG_LEVEL: 'info' },
      { destination: out.stream },
    );
    logger.debug('hidden');
    logger.info({ port: 9950 }, 'listening');
    await flush();
    const lines = out.text().trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? '')).toMatchObject({
      level: 30,
      name: 'mwc-server',
      port: 9950,
      msg: 'listening',
    });
  });

  it('writes pretty lines through pino-pretty in development', async () => {
    const out = sink();
    const logger = await createLogger(
      { NODE_ENV: 'development', MWC_LOG_LEVEL: 'info' },
      { destination: out.stream },
    );
    logger.info('hello pretty');
    await flush();
    expect(out.text()).toContain('hello pretty');
    expect(() => JSON.parse(out.text())).toThrow();
  });

  it('falls back to JSON and says so when pino-pretty cannot be loaded', async () => {
    const out = sink();
    const logger = await createLogger(
      { NODE_ENV: 'development', MWC_LOG_LEVEL: 'info' },
      {
        destination: out.stream,
        loadPretty: () => Promise.reject(new Error("Cannot find package 'pino-pretty'")),
      },
    );
    logger.info('after fallback');
    await flush();
    const lines = out
      .text()
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { msg: string });
    expect(lines.map((line) => line.msg)).toEqual([
      'pino-pretty is not available; logging JSON',
      'after fallback',
    ]);
  });
});
