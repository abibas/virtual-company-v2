import type { Logger } from 'pino';
import { type CliDeps, cliTranscribe, type SpeechFiles } from './cli.ts';
import { type Spawn, warmServer } from './server.ts';
import type { SpeechText } from './transcript.ts';
import { MIN_VOICE_MS, readWav, voicedMs, writeWav } from './wav.ts';

/**
 * Dictation's transcription on the server's own computer (docs/speech.md): a 16 kHz mono WAV of at most two minutes
 * becomes text with whisper.cpp, through the warm whisper-server, else whisper-cli. A clip with under 300 ms of voice
 * is not transcribed (empty text): Whisper invents words on silence. Neither the audio nor its text is logged, and the
 * clip is kept only while it is transcribed (whisper-cli's temporary folder is removed after each clip).
 */

export type SpeechErrorCode = 'not_wav' | 'too_long' | 'failed';

/** Why a clip was not transcribed: not a 16 kHz mono WAV, longer than two minutes, or whisper.cpp failed. */
export class SpeechError extends Error {
  readonly code: SpeechErrorCode;

  constructor(code: SpeechErrorCode, message: string) {
    super(message);
    this.name = 'SpeechError';
    this.code = code;
  }
}

/** What the speech module transcribes through: this computer's whisper.cpp, or a fake in tests. */
export interface Speech {
  /** The clip's text and words; throws a `SpeechError`. */
  transcribe(wav: Uint8Array): Promise<SpeechText>;
  /** Stops the warm server (the API's shutdown). */
  close(): Promise<void>;
}

/** The binaries and the model found, and how they run. */
export interface WhisperDeps {
  /** whisper-server's path, or undefined when only whisper-cli is installed. */
  readonly server: string | undefined;
  /** whisper-cli's path, or undefined when only whisper-server is installed. */
  readonly cli: string | undefined;
  readonly model: string;
  readonly port: number;
  readonly language: string;
  readonly prompt: string | undefined;
  readonly threads: number;
  readonly spawn: Spawn;
  readonly fetch: typeof fetch;
  readonly files: SpeechFiles;
  readonly sleep: (ms: number) => Promise<void>;
  readonly now: () => number;
  readonly later: CliDeps['later'];
  readonly logger: Logger;
}

const reasonOf = (error: unknown) => (error instanceof Error ? error.message : 'unknown');

export function createWhisper(deps: WhisperDeps): Speech {
  const server = deps.server === undefined ? undefined : warmServer({ ...deps, bin: deps.server });
  const cli = deps.cli === undefined ? undefined : { ...deps, bin: deps.cli };

  async function withServer(wav: Uint8Array<ArrayBuffer>): Promise<SpeechText | undefined> {
    const port = await server?.port();
    if (server === undefined || port === undefined) return undefined;
    try {
      return await server.transcribe(port, wav);
    } catch (error) {
      deps.logger.warn(
        { reason: reasonOf(error) },
        'speech: whisper-server failed a clip; trying whisper-cli',
      );
      return undefined;
    }
  }

  async function transcribe(clip: Uint8Array): Promise<SpeechText> {
    const read = readWav(clip);
    if (!read.ok) {
      if (read.reason === 'too_long') throw new SpeechError('too_long', 'A clip is at most two minutes long');
      throw new SpeechError('not_wav', 'Send a 16 kHz mono 16-bit PCM WAV');
    }
    if (voicedMs(read.pcm) < MIN_VOICE_MS) return { text: '', words: [] };
    const wav = writeWav(read.pcm);
    const heard = await withServer(wav);
    if (heard !== undefined) return heard;
    if (cli === undefined) throw new SpeechError('failed', 'whisper-server could not transcribe the clip');
    try {
      return await cliTranscribe(cli, wav);
    } catch (error) {
      deps.logger.warn({ reason: reasonOf(error) }, 'speech: whisper-cli failed a clip');
      throw new SpeechError('failed', 'whisper.cpp could not transcribe the clip');
    }
  }

  return { transcribe, close: async () => server?.close() };
}
