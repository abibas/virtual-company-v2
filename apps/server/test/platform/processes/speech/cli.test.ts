import { describe, expect, it } from 'vitest';
import { cliTranscribe } from '../../../../src/platform/processes/speech/cli.ts';
import type { SpawnCall } from '../../../fixtures/credentials/sign-in/child.ts';
import { CLI_JSON, wavClip } from '../../../fixtures/speech/clips.ts';
import { fakeHost } from '../../../fixtures/speech/host.ts';

const MODEL = '/models/ggml-base.en.bin';

function setup(script?: (call: SpawnCall) => void, prompt?: string) {
  const host = fakeHost(script);
  const deps = { ...host.deps, bin: '/opt/homebrew/bin/whisper-cli', model: MODEL, language: 'en', prompt };
  return { host, run: (wav: Uint8Array) => cliTranscribe(deps, wav) };
}

describe('cliTranscribe', () => {
  it('runs whisper-cli on the clip in a temporary folder, reads its -ojf file and removes the folder', async () => {
    const { host, run } = setup(undefined, 'Kyiv.');
    host.files.output = JSON.stringify(CLI_JSON);
    const wav = wavClip(100);
    expect(await run(wav)).toEqual({
      text: 'Hi, again.',
      words: [
        { text: 'Hi,', start: 50, end: 320 },
        { text: 'again.', start: 400, end: 950 },
      ],
    });
    expect(host.calls[0]?.command).toBe('/opt/homebrew/bin/whisper-cli');
    expect(host.calls[0]?.args).toEqual([
      ...['-m', MODEL, '-f', '/tmp/speech-1/clip.wav', '-l', 'en', '-np', '-ojf', '-of', '/tmp/speech-1/out'],
      ...['-t', '4', '-dtw', 'base.en', '-nfa', '--prompt', 'Kyiv.'],
    ]);
    expect(host.files.removed).toEqual(['/tmp/speech-1']);
    expect(host.files.files.size).toBe(0);
    expect(host.timers[0]?.cancelled).toBe(true);
  });

  it('fails on another exit code, removing the folder', async () => {
    const { host, run } = setup((call) => setImmediate(() => call.child.emit('close', 1)));
    await expect(run(wavClip(100))).rejects.toThrow('whisper-cli exited 1');
    expect(host.files.removed).toEqual(['/tmp/speech-1']);
    expect(host.calls[0]?.args).not.toContain('--prompt');
  });

  it('fails when whisper-cli cannot start', async () => {
    const { host, run } = setup((call) => call.child.failToStart());
    await expect(run(wavClip(100))).rejects.toThrow('whisper-cli could not start');
    expect(host.files.removed).toEqual(['/tmp/speech-1']);
  });

  it('kills whisper-cli after two minutes', async () => {
    const { host, run } = setup((call) => {
      call.child.kill = (signal: string) => {
        call.child.signals.push(signal);
        setImmediate(() => call.child.emit('close', null));
        return true;
      };
    });
    const running = run(wavClip(100));
    await new Promise((resolve) => setImmediate(resolve));
    expect(host.timers[0]?.ms).toBe(120_000);
    host.timers[0]?.callback();
    await expect(running).rejects.toThrow('whisper-cli took too long');
    expect(host.calls[0]?.child.signals).toEqual(['SIGKILL']);
  });

  it('fails when whisper-cli wrote no answer', async () => {
    const { run } = setup();
    await expect(run(wavClip(100))).rejects.toThrow(/ENOENT/);
  });
});
