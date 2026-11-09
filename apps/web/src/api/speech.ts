import type { Api } from './client.ts';
import { call } from './errors.ts';

/**
 * `POST /api/me/speech/transcribe` (docs/speech.md): a dictated clip, a 16 kHz mono WAV, becomes its text with
 * whisper.cpp on the server's computer. The clip is the body itself; the answer is `{ text, words }`.
 */
export function transcribeClip(api: Api, clip: Blob) {
  return call(
    api.api.me.speech.transcribe.$post(undefined, {
      headers: { 'content-type': 'audio/wav' },
      init: { body: clip },
    }),
  );
}
