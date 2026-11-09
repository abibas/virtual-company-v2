/**
 * The clip dictation sends (docs/speech.md): a 16 kHz mono 16-bit PCM WAV of at most two minutes. Read here into its
 * samples (any extra header chunks skipped), measured for voice, and written back as the plain 44-byte-header WAV
 * whisper.cpp reads. Pure: nothing here touches a file or logs the audio.
 */

export const SPEECH_RATE = 16_000;
/** The longest clip: two minutes, as the composer's recorder caps it. */
export const SPEECH_MAX_MS = 2 * 60 * 1000;
/** A clip may run this much past its cap: the recorder stops a moment after it. */
const MAX_MS_SLACK = 2_000;
/** The largest body the route reads (413 past it); two minutes of samples are about 3.8 MB. */
export const SPEECH_MAX_BYTES = 8 * 1024 * 1024;
/** Clips with less voice than this are not transcribed: Whisper invents words on silence. */
export const MIN_VOICE_MS = 300;

/** 20 ms frames, and the level a frame needs to count as voice. */
const FRAME = 320;
const VOICE_DBFS = -42;

export type WavRead =
  | { readonly ok: true; readonly pcm: Int16Array }
  | { readonly ok: false; readonly reason: 'not_wav' | 'too_long' };

const ascii = (bytes: Uint8Array, from: number, to: number) =>
  String.fromCharCode(...bytes.subarray(from, Math.min(to, bytes.length)));

interface Format {
  readonly tag: number;
  readonly channels: number;
  readonly rate: number;
  readonly bits: number;
}

/** The `fmt ` and `data` chunks of a RIFF/WAVE file, or undefined when either is missing. */
function chunks(bytes: Uint8Array): { format: Format; data: Uint8Array } | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let format: Format | undefined;
  for (let at = 12; at + 8 <= bytes.length; ) {
    const id = ascii(bytes, at, at + 4);
    const size = view.getUint32(at + 4, true);
    const body = at + 8;
    if (id === 'fmt ' && size >= 16 && body + 16 <= bytes.length) {
      format = {
        tag: view.getUint16(body, true),
        channels: view.getUint16(body + 2, true),
        rate: view.getUint32(body + 4, true),
        bits: view.getUint16(body + 14, true),
      };
    }
    if (id === 'data') {
      if (format === undefined) return undefined;
      return { format, data: bytes.subarray(body, Math.min(bytes.length, body + size)) };
    }
    at = body + size + (size % 2);
  }
  return undefined;
}

/** The samples of a 16 kHz mono 16-bit PCM WAV, `not_wav` for anything else, `too_long` past two minutes. */
export function readWav(bytes: Uint8Array): WavRead {
  if (bytes.length < 12 || ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 12) !== 'WAVE')
    return { ok: false, reason: 'not_wav' };
  const found = chunks(bytes);
  if (found === undefined) return { ok: false, reason: 'not_wav' };
  const { format, data } = found;
  if (format.tag !== 1 || format.channels !== 1 || format.rate !== SPEECH_RATE || format.bits !== 16)
    return { ok: false, reason: 'not_wav' };
  const pcm = new Int16Array(Math.floor(data.length / 2));
  new Uint8Array(pcm.buffer).set(data.subarray(0, pcm.length * 2));
  if (clipMs(pcm) > SPEECH_MAX_MS + MAX_MS_SLACK) return { ok: false, reason: 'too_long' };
  return { ok: true, pcm };
}

/** How long the samples play, in ms. */
export const clipMs = (pcm: Int16Array): number => Math.round((pcm.length / SPEECH_RATE) * 1000);

/** Milliseconds of 20 ms frames louder than -42 dBFS. */
export function voicedMs(pcm: Int16Array): number {
  let frames = 0;
  for (let at = 0; at + FRAME <= pcm.length; at += FRAME) {
    let sum = 0;
    for (let i = at; i < at + FRAME; i++) sum += (pcm[i] as number) ** 2;
    const rms = Math.sqrt(sum / FRAME) / 32768;
    if (rms > 0 && 20 * Math.log10(rms) > VOICE_DBFS) frames++;
  }
  return frames * 20;
}

/** A plain WAV of the samples (44-byte header, 16 kHz mono 16-bit), what whisper.cpp reads as is. */
export function writeWav(pcm: Int16Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(44 + pcm.byteLength);
  const view = new DataView(out.buffer);
  const text = (at: number, value: string) => {
    for (let i = 0; i < value.length; i++) out[at + i] = value.charCodeAt(i);
  };
  text(0, 'RIFF');
  view.setUint32(4, 36 + pcm.byteLength, true);
  text(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, SPEECH_RATE, true);
  view.setUint32(28, SPEECH_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, pcm.byteLength, true);
  out.set(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength), 44);
  return out;
}
