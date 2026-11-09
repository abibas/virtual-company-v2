import { describe, expect, it } from 'vitest';
import { warmServer } from '../../../../src/platform/processes/speech/server.ts';
import { SERVER_JSON, wavClip } from '../../../fixtures/speech/clips.ts';
import { fakeHost } from '../../../fixtures/speech/host.ts';

const MODEL = '/models/ggml-large-v3-turbo-q5_0.bin';

function setup(prompt?: string) {
  const host = fakeHost();
  const server = warmServer({
    ...host.deps,
    bin: '/opt/homebrew/bin/whisper-server',
    model: MODEL,
    port: 9957,
    language: 'auto',
    prompt,
    logger: host.logger,
  });
  return { host, server };
}

describe('warmServer', () => {
  it('starts nothing until asked, then whisper-server on 127.0.0.1, tied to the API, until /health answers', async () => {
    const { host, server } = setup();
    expect(host.calls).toEqual([]);
    host.server.healthy = false;
    const pending = server.port();
    await new Promise((resolve) => setImmediate(resolve));
    host.server.healthy = true;
    expect(await pending).toBe(9957);
    expect(host.calls).toHaveLength(1);
    const [call] = host.calls;
    expect(call?.command).toBe('/bin/sh');
    expect(call?.args.slice(2)).toEqual([
      'whisper-server',
      '/opt/homebrew/bin/whisper-server',
      ...['-m', MODEL, '--host', '127.0.0.1', '--port', '9957', '-l', 'auto', '-t', '4'],
      ...['-dtw', 'large.v3.turbo', '-nfa'],
    ]);
    expect(call?.args[1]).toContain('cat <&3');
    expect(call?.options.stdio).toEqual(['pipe', 'ignore', 'ignore']);
    expect(host.server.urls.every((url) => url === 'http://127.0.0.1:9957/health')).toBe(true);
    expect(host.logs.some((line) => line.msg === 'speech: whisper-server is warm')).toBe(true);
  });

  it('keeps one warm server for every clip, and starts one again once it died', async () => {
    const { host, server } = setup();
    const [first, second] = await Promise.all([server.port(), server.port()]);
    expect([first, second, await server.port()]).toEqual([9957, 9957, 9957]);
    expect(host.calls).toHaveLength(1);
    host.calls[0]?.child.emit('exit', 1, null);
    expect(await server.port()).toBe(9957);
    expect(host.calls).toHaveLength(2);
  });

  it('gives up when the server exits or never answers, stops it, and waits a minute before trying again', async () => {
    const { host, server } = setup();
    host.server.healthy = false;
    const exited = server.port();
    host.calls[0]?.child.emit('exit', 1, null);
    expect(await exited).toBeUndefined();
    expect(await server.port()).toBeUndefined(); // within the minute: not tried
    expect(host.calls).toHaveLength(1);
    host.clock.ms += 60_000;
    expect(await server.port()).toBeUndefined(); // tried again: 90 s without /health
    expect(host.calls).toHaveLength(2);
    expect(host.calls[1]?.child.signals).toEqual(['SIGTERM']);
    expect(host.logs.filter((line) => line.msg.includes('did not start'))).toHaveLength(2);
  });

  it('sends a clip to /inference as verbose_json with the prompt and reads its words', async () => {
    const { host, server } = setup('Kyiv, devbox.');
    host.server.inference = { status: 200, body: SERVER_JSON };
    const wav = wavClip(100);
    const heard = await server.transcribe(9957, wav);
    expect(heard.text).toBe('Hello there.');
    expect(host.server.forms).toEqual([
      { file: wav.length, response_format: 'verbose_json', prompt: 'Kyiv, devbox.' },
    ]);
    host.server.inference = { status: 500, body: {} };
    await expect(server.transcribe(9957, wav)).rejects.toThrow('whisper-server answered 500');
  });

  it('sends no prompt when none is set', async () => {
    const { host, server } = setup();
    await server.transcribe(9957, wavClip(100));
    expect(host.server.forms[0]).not.toHaveProperty('prompt');
  });

  it('stops the warm server on close, and never starts one after', async () => {
    const { host, server } = setup();
    await server.port();
    const child = host.calls[0]?.child;
    const closing = server.close();
    child?.emit('exit', null, 'SIGTERM');
    await closing;
    expect(child?.signals).toEqual(['SIGTERM']);
    expect(child?.stdin.writableEnded).toBe(true);
    expect(await server.port()).toBeUndefined();
    expect(host.calls).toHaveLength(1);
    await server.close(); // again is fine
  });

  it('stops a server that was starting when the API shut down', async () => {
    const { host, server } = setup();
    host.server.healthy = false;
    const starting = server.port();
    await server.close();
    expect(await starting).toBeUndefined();
    expect(host.calls[0]?.child.signals).toEqual(['SIGTERM']);
    expect(host.logs.some((line) => line.msg.includes('did not start'))).toBe(false);
  });

  it('stops a server that answered just after the API began to shut down', async () => {
    const { host, server } = setup();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const slowFetch = host.deps.fetch;
    const app = warmServer({
      ...host.deps,
      fetch: async (input, init) => {
        await gate;
        return slowFetch(input, init);
      },
      bin: '/bin/whisper-server',
      model: MODEL,
      port: 9957,
      language: 'en',
      prompt: undefined,
      logger: host.logger,
    });
    const starting = app.port();
    await new Promise((resolve) => setImmediate(resolve));
    const closing = app.close();
    release();
    expect(await starting).toBeUndefined();
    await closing;
    expect(host.calls[0]?.child.signals).toEqual(['SIGTERM']);
    await server.close();
  });
});
