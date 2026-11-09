import { describe, expect, it } from 'vitest';
import { createWhisper, SpeechError } from '../../../../src/platform/processes/speech/whisper.ts';
import { CLI_JSON, SERVER_JSON, wavClip } from '../../../fixtures/speech/clips.ts';
import { fakeHost } from '../../../fixtures/speech/host.ts';

const BINS = { server: '/bin/whisper-server', cli: '/bin/whisper-cli' };

function setup(bins: { server?: string; cli?: string } = BINS) {
  const host = fakeHost();
  host.server.inference = { status: 200, body: SERVER_JSON };
  host.files.output = JSON.stringify(CLI_JSON);
  const speech = createWhisper({
    ...host.deps,
    server: bins.server,
    cli: bins.cli,
    model: '/m/ggml-large-v3-turbo-q5_0.bin',
    port: 9957,
    language: 'auto',
    prompt: undefined,
    logger: host.logger,
  });
  return { host, speech };
}

const commands = (host: ReturnType<typeof fakeHost>) => host.calls.map((call) => call.command);
const failure = (code: string) => expect.objectContaining({ name: 'SpeechError', code });

describe('createWhisper', () => {
  it('starts nothing until the first clip, then transcribes through the warm server and reuses it', async () => {
    const { host, speech } = setup();
    expect(host.calls).toEqual([]);
    expect((await speech.transcribe(wavClip(1_000))).text).toBe('Hello there.');
    expect((await speech.transcribe(wavClip(800))).words).toHaveLength(2);
    expect(commands(host)).toEqual(['/bin/sh']);
    expect(host.server.forms).toHaveLength(2);
  });

  it('falls back to whisper-cli when the server does not start, and when it fails a clip', async () => {
    const { host, speech } = setup();
    host.server.healthy = false;
    const first = speech.transcribe(wavClip(1_000));
    await new Promise((resolve) => setImmediate(resolve));
    host.calls[0]?.child.emit('exit', 1, null);
    expect((await first).text).toBe('Hi, again.');
    expect(commands(host)).toEqual(['/bin/sh', '/bin/whisper-cli']);

    host.clock.ms += 60_000;
    host.server.healthy = true;
    host.server.inference = { status: 500, body: {} };
    expect((await speech.transcribe(wavClip(1_000))).text).toBe('Hi, again.');
    expect(commands(host)).toEqual(['/bin/sh', '/bin/whisper-cli', '/bin/sh', '/bin/whisper-cli']);
    expect(host.logs.find((line) => line.msg.includes('failed a clip'))).toMatchObject({
      reason: 'whisper-server answered 500',
    });
  });

  it('uses whisper-cli alone when whisper-server is not installed', async () => {
    const { host, speech } = setup({ cli: BINS.cli });
    expect((await speech.transcribe(wavClip(1_000))).text).toBe('Hi, again.');
    expect(commands(host)).toEqual(['/bin/whisper-cli']);
  });

  it('fails the clip when the server fails and there is no whisper-cli, or whisper-cli fails too', async () => {
    const serverOnly = setup({ server: BINS.server });
    serverOnly.host.server.inference = { status: 500, body: {} };
    await expect(serverOnly.speech.transcribe(wavClip(1_000))).rejects.toEqual(failure('failed'));

    const both = setup();
    both.host.server.inference = { status: 500, body: {} };
    both.host.files.output = undefined;
    await expect(both.speech.transcribe(wavClip(1_000))).rejects.toEqual(failure('failed'));
    expect(both.host.logs.some((line) => line.msg === 'speech: whisper-cli failed a clip')).toBe(true);
  });

  it('returns empty text for a clip with under 300 ms of voice, without running whisper', async () => {
    const { host, speech } = setup();
    expect(await speech.transcribe(wavClip(2_000, { level: 0 }))).toEqual({ text: '', words: [] });
    expect(await speech.transcribe(wavClip(200))).toEqual({ text: '', words: [] });
    expect(host.calls).toEqual([]);
  });

  it('drops [BLANK_AUDIO]: a clip whisper hears as blank comes back empty', async () => {
    const { host, speech } = setup();
    host.server.inference = { status: 200, body: { segments: [{ text: ' [BLANK_AUDIO]', words: [] }] } };
    expect(await speech.transcribe(wavClip(1_000))).toEqual({ text: '', words: [] });
  });

  it('refuses what is not a 16 kHz mono WAV, and a clip over two minutes', async () => {
    const { speech } = setup();
    await expect(speech.transcribe(wavClip(100, { rate: 48_000 }))).rejects.toEqual(failure('not_wav'));
    await expect(speech.transcribe(wavClip(125_000, { level: 0 }))).rejects.toBeInstanceOf(SpeechError);
    await expect(speech.transcribe(wavClip(125_000, { level: 0 }))).rejects.toEqual(failure('too_long'));
  });

  it('stops the warm server on close; without one, close does nothing', async () => {
    const { host, speech } = setup();
    await speech.transcribe(wavClip(1_000));
    const closing = speech.close();
    host.calls[0]?.child.emit('exit', null, 'SIGTERM');
    await closing;
    expect(host.calls[0]?.child.signals).toEqual(['SIGTERM']);
    await setup({ cli: BINS.cli }).speech.close();
  });

  it('never logs the audio or the text', async () => {
    const { host, speech } = setup();
    host.server.inference = { status: 500, body: {} };
    await speech.transcribe(wavClip(1_000));
    const logged = JSON.stringify(host.logs);
    expect(logged).not.toContain('Hi, again');
    expect(logged).not.toContain('RIFF');
  });
});
