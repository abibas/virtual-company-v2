import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { availableParallelism, homedir, tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import type { Config } from '@mwc/shared/config';
import type { Logger } from 'pino';
import { createWhisper, type Speech, type WhisperDeps } from './whisper.ts';

/**
 * Whether this server transcribes dictation, as MWC_WHISPER says (docs/speech.md): with `auto`, outside production and
 * tests, when whisper.cpp's binaries (`whisper-server`, `whisper-cli`: either is enough) are on the PATH or in Homebrew's
 * folders and a model is found: MWC_WHISPER_MODEL, else the first known model file that exists. Looking starts no
 * process; nothing runs until the first clip. Logs one line: what it uses, or why dictation is off.
 */

/** Where the binaries are looked for after the PATH's folders. */
export const WHISPER_DIRS: readonly string[] = ['/opt/homebrew/bin', '/usr/local/bin'];

/** The known places of the model (`ggml-large-v3-turbo-q5_0.bin`) under the home folder, in order. */
export const KNOWN_MODELS: readonly string[] = [
  'Library/Application Support/Airia Bug Report/models/ggml-large-v3-turbo-q5_0.bin',
  '.cache/whisper/ggml-large-v3-turbo-q5_0.bin',
];

/** This computer, or a fake: where to look and how whisper.cpp runs. */
export interface SpeechHost
  extends Omit<WhisperDeps, 'server' | 'cli' | 'model' | 'port' | 'language' | 'prompt' | 'logger'> {
  readonly path: string | undefined;
  readonly home: string;
  readonly exists: (path: string) => boolean;
}

/** This computer: its PATH, home folder and files, `child_process.spawn`, `fetch` and timers. Starts nothing. */
export function nodeSpeechHost(env: Readonly<Record<string, string | undefined>> = process.env): SpeechHost {
  return {
    path: env.PATH,
    home: homedir(),
    exists: existsSync,
    spawn,
    fetch,
    files: {
      tempDir: () => mkdtemp(join(tmpdir(), 'mwc-speech-')),
      write: (path, bytes) => writeFile(path, bytes, { mode: 0o600 }),
      read: (path) => readFile(path, 'utf8'),
      remove: (dir) => rm(dir, { recursive: true, force: true }),
    },
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => performance.now(),
    later: (ms, callback) => {
      const timer = setTimeout(callback, ms);
      return () => clearTimeout(timer);
    },
    threads: Math.max(1, Math.min(8, availableParallelism())),
  };
}

/** The full path of `name` in the PATH's absolute folders, then `WHISPER_DIRS`, or undefined. */
function findBinary(name: string, host: SpeechHost): string | undefined {
  const dirs = [...(host.path ?? '').split(':').filter((dir) => isAbsolute(dir)), ...WHISPER_DIRS];
  return dirs.map((dir) => join(dir, name)).find((file) => host.exists(file));
}

/** MWC_WHISPER_MODEL (`~/` the home folder) when it exists, else the first known model that does. */
function findModel(configured: string | undefined, host: SpeechHost): string | undefined {
  if (configured !== undefined) {
    const file = configured.startsWith('~/') ? join(host.home, configured.slice(2)) : configured;
    return host.exists(file) ? file : undefined;
  }
  return KNOWN_MODELS.map((file) => join(host.home, file)).find((file) => host.exists(file));
}

type SpeechConfig = Pick<
  Config,
  | 'NODE_ENV'
  | 'MWC_WHISPER'
  | 'MWC_WHISPER_MODEL'
  | 'MWC_WHISPER_LANGUAGE'
  | 'MWC_WHISPER_PROMPT'
  | 'MWC_WHISPER_PORT'
>;

/** Why dictation is off before anything is looked for, or undefined to look. */
function offReason(config: SpeechConfig): string | undefined {
  if (config.MWC_WHISPER === 'off') return 'MWC_WHISPER is off';
  if (config.NODE_ENV === 'production') return 'whisper.cpp is not used in production';
  if (config.NODE_ENV === 'test') return 'whisper.cpp is not used in tests';
  return undefined;
}

export function speechFromConfig(
  config: SpeechConfig,
  logger: Logger,
  host: SpeechHost = nodeSpeechHost(),
): Speech | undefined {
  const off = offReason(config);
  if (off !== undefined) {
    logger.debug({ whisper: config.MWC_WHISPER }, `speech: dictation is off (${off})`);
    return undefined;
  }
  const server = findBinary('whisper-server', host);
  const cli = findBinary('whisper-cli', host);
  const model = findModel(config.MWC_WHISPER_MODEL, host);
  if ((server === undefined && cli === undefined) || model === undefined) {
    const missing = [
      ...(server === undefined && cli === undefined ? ['whisper.cpp (brew install whisper-cpp)'] : []),
      ...(model === undefined
        ? [config.MWC_WHISPER_MODEL === undefined ? 'a Whisper model' : 'the MWC_WHISPER_MODEL file']
        : []),
    ];
    logger.info(
      { whisper: config.MWC_WHISPER },
      `speech: dictation is off: ${missing.join(' and ')} not found`,
    );
    return undefined;
  }
  logger.info(
    { server, cli, model, port: config.MWC_WHISPER_PORT, language: config.MWC_WHISPER_LANGUAGE },
    "speech: dictation transcribes with this computer's whisper.cpp",
  );
  return createWhisper({
    ...host,
    server,
    cli,
    model,
    port: config.MWC_WHISPER_PORT,
    language: config.MWC_WHISPER_LANGUAGE,
    prompt: config.MWC_WHISPER_PROMPT,
    logger,
  });
}
