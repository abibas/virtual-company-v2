import type { Spawn } from './server.ts';
import { alignmentArgs, fromCliJson, type SpeechText } from './transcript.ts';

/**
 * whisper-cli on one clip (docs/speech.md), when the warm server cannot start or answer: the clip goes to a private
 * temporary folder, whisper-cli writes its `-ojf` file next to it, and the folder is removed whatever happens. Slower
 * (the model loads per clip) but needs no port. Node's `spawn` and the file calls are injected.
 */

/** The temporary folder's file calls (`node:fs/promises` on this computer). */
export interface SpeechFiles {
  /** A new private folder (0700) for one clip. */
  tempDir(): Promise<string>;
  write(path: string, bytes: Uint8Array): Promise<void>;
  read(path: string): Promise<string>;
  /** Removes the folder and what is in it; quiet when it is gone. */
  remove(dir: string): Promise<void>;
}

export interface CliDeps {
  /** The whisper-cli binary. */
  readonly bin: string;
  readonly model: string;
  readonly language: string;
  readonly prompt: string | undefined;
  readonly threads: number;
  readonly spawn: Spawn;
  readonly files: SpeechFiles;
  /** Runs `callback` after `ms`; returns its cancel. */
  readonly later: (ms: number, callback: () => void) => () => void;
}

const TRANSCRIBE_MS = 120_000;

/** Runs whisper-cli to its end: resolves on exit 0, rejects on another code, a spawn error or the 2-minute limit. */
function runToEnd(deps: CliDeps, args: readonly string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = deps.spawn(deps.bin, args, { stdio: ['ignore', 'ignore', 'ignore'] });
    let timedOut = false;
    const cancel = deps.later(TRANSCRIBE_MS, () => {
      timedOut = true;
      child.kill('SIGKILL');
    });
    child.once('error', () => {
      cancel();
      reject(new Error('whisper-cli could not start'));
    });
    child.once('close', (code: number | null) => {
      cancel();
      if (code === 0) resolve();
      else reject(new Error(timedOut ? 'whisper-cli took too long' : `whisper-cli exited ${code}`));
    });
  });
}

export async function cliTranscribe(deps: CliDeps, wav: Uint8Array): Promise<SpeechText> {
  const dir = await deps.files.tempDir();
  try {
    const clip = `${dir}/clip.wav`;
    await deps.files.write(clip, wav);
    const args = ['-m', deps.model, '-f', clip, '-l', deps.language, '-np', '-ojf', '-of', `${dir}/out`];
    args.push('-t', String(deps.threads), ...alignmentArgs(deps.model));
    if (deps.prompt !== undefined) args.push('--prompt', deps.prompt);
    await runToEnd(deps, args);
    return fromCliJson(JSON.parse(await deps.files.read(`${dir}/out.json`)));
  } finally {
    await deps.files.remove(dir);
  }
}
