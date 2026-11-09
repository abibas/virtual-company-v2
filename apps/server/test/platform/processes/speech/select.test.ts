import { existsSync } from 'node:fs';
import { loadConfig } from '@mwc/shared/config';
import { captureLogger } from '@mwc/testkit';
import { describe, expect, it } from 'vitest';
import {
  KNOWN_MODELS,
  nodeSpeechHost,
  type SpeechHost,
  speechFromConfig,
} from '../../../../src/platform/processes/speech/select.ts';
import { wavClip } from '../../../fixtures/speech/clips.ts';
import { fakeHost } from '../../../fixtures/speech/host.ts';

const HOME = '/Users/ihor';
const DEV = { DATABASE_URL: 'postgres://mwc:mwc@127.0.0.1:9999/mwc', NODE_ENV: 'development' };
const config = (env: Record<string, string> = {}) => loadConfig({ ...DEV, ...env });

/** A host on which only `files` exist; its PATH is `/usr/bin:relative`. */
function host(files: readonly string[]) {
  const fake = fakeHost();
  const speechHost: SpeechHost = {
    ...fake.deps,
    path: '/usr/bin:relative/bin',
    home: HOME,
    exists: (path) => files.includes(path),
  };
  return { fake, speechHost };
}

const FIRST_MODEL = `${HOME}/${KNOWN_MODELS[0]}`;
const SECOND_MODEL = `${HOME}/${KNOWN_MODELS[1]}`;

describe('speechFromConfig', () => {
  it('is off with MWC_WHISPER=off, in production and in tests, without looking', () => {
    const { logger, lines } = captureLogger();
    const everything = host(['/opt/homebrew/bin/whisper-server', FIRST_MODEL]).speechHost;
    const looked: string[] = [];
    const exists = (path: string) => {
      looked.push(path);
      return true;
    };
    const watched = { ...everything, exists };
    const production = { NODE_ENV: 'production', MWC_MASTER_KEY: Buffer.alloc(32, 1).toString('base64') };
    expect(speechFromConfig(config({ MWC_WHISPER: 'off' }), logger, watched)).toBeUndefined();
    expect(speechFromConfig(config(production), logger, watched)).toBeUndefined();
    expect(speechFromConfig(config({ NODE_ENV: 'test' }), logger, watched)).toBeUndefined();
    expect(looked).toEqual([]);
    expect(lines.map((line) => line.msg)).toEqual([
      'speech: dictation is off (MWC_WHISPER is off)',
      'speech: dictation is off (whisper.cpp is not used in production)',
      'speech: dictation is off (whisper.cpp is not used in tests)',
    ]);
  });

  it("uses Homebrew's whisper.cpp and the first known model that exists, and says so", async () => {
    const { logger, lines } = captureLogger();
    const { fake, speechHost } = host([
      '/opt/homebrew/bin/whisper-server',
      '/opt/homebrew/bin/whisper-cli',
      SECOND_MODEL,
    ]);
    const speech = speechFromConfig(config({ MWC_WHISPER_PORT: '9958' }), logger, speechHost);
    expect(speech).toBeDefined();
    expect(lines.at(-1)).toMatchObject({
      msg: "speech: dictation transcribes with this computer's whisper.cpp",
      server: '/opt/homebrew/bin/whisper-server',
      cli: '/opt/homebrew/bin/whisper-cli',
      model: SECOND_MODEL,
      port: 9958,
      language: 'auto',
    });
    await speech?.transcribe(wavClip(1_000));
    expect(fake.calls[0]?.args).toContain(SECOND_MODEL);
  });

  it('prefers the PATH, takes either binary alone, and expands ~/ in MWC_WHISPER_MODEL', () => {
    const { logger, lines } = captureLogger();
    const model = `${HOME}/models/ggml-base.bin`;
    const { speechHost } = host(['/usr/bin/whisper-cli', '/usr/local/bin/whisper-cli', model, FIRST_MODEL]);
    expect(
      speechFromConfig(config({ MWC_WHISPER_MODEL: '~/models/ggml-base.bin' }), logger, speechHost),
    ).toBeDefined();
    expect(lines.at(-1)).toMatchObject({ cli: '/usr/bin/whisper-cli', model });
    expect(lines.at(-1)).not.toHaveProperty('server');
    expect(speechFromConfig(config({ MWC_WHISPER_MODEL: model }), logger, speechHost)).toBeDefined();
  });

  it('is off, saying what is missing, without whisper.cpp or a model', () => {
    const { logger, lines } = captureLogger();
    expect(speechFromConfig(config(), logger, host([FIRST_MODEL]).speechHost)).toBeUndefined();
    expect(
      speechFromConfig(config(), logger, host(['/opt/homebrew/bin/whisper-cli']).speechHost),
    ).toBeUndefined();
    expect(speechFromConfig(config(), logger, host([]).speechHost)).toBeUndefined();
    const named = config({ MWC_WHISPER_MODEL: '/nowhere/ggml-base.bin' });
    expect(
      speechFromConfig(named, logger, host(['/opt/homebrew/bin/whisper-cli', FIRST_MODEL]).speechHost),
    ).toBeUndefined();
    expect(lines.map((line) => line.msg)).toEqual([
      'speech: dictation is off: whisper.cpp (brew install whisper-cpp) not found',
      'speech: dictation is off: a Whisper model not found',
      'speech: dictation is off: whisper.cpp (brew install whisper-cpp) and a Whisper model not found',
      'speech: dictation is off: the MWC_WHISPER_MODEL file not found',
    ]);
  });
});

describe('nodeSpeechHost', () => {
  it("is this computer's PATH, home and files, with a private temporary folder per clip", async () => {
    const node = nodeSpeechHost({ PATH: '/usr/bin' });
    expect(node.path).toBe('/usr/bin');
    expect(node.threads).toBeGreaterThanOrEqual(1);
    expect(node.threads).toBeLessThanOrEqual(8);
    const dir = await node.files.tempDir();
    await node.files.write(`${dir}/out.json`, new TextEncoder().encode('{"ok":true}'));
    expect(await node.files.read(`${dir}/out.json`)).toBe('{"ok":true}');
    await node.files.remove(dir);
    expect(existsSync(dir)).toBe(false);
    await node.sleep(0);
    expect(node.now()).toBeGreaterThan(0);
    let fired = false;
    const cancel = node.later(0, () => {
      fired = true;
    });
    cancel();
    await node.sleep(5);
    expect(fired).toBe(false);
    expect(nodeSpeechHost().home.length).toBeGreaterThan(0);
  });
});
