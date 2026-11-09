/**
 * Clips for the speech tests: WAVs made in memory (a tone loud enough to count as voice, silence, or another format),
 * and whisper.cpp's two answer shapes. No real audio and no real whisper run.
 */

export interface ClipOptions {
  /** Peak level 0..1 of the tone; 0 is silence. Default 0.5. */
  readonly level?: number;
  readonly rate?: number;
  readonly channels?: number;
  readonly bits?: number;
  /** The format tag: 1 is PCM. */
  readonly tag?: number;
  /** A `LIST` chunk of this many bytes before `fmt ` (odd sizes are padded, as RIFF says). */
  readonly listBytes?: number;
}

/** A RIFF/WAVE file of `ms` of a 440 Hz tone (16 kHz mono 16-bit unless told otherwise). */
export function wavClip(ms: number, options: ClipOptions = {}): Uint8Array<ArrayBuffer> {
  const { level = 0.5, rate = 16_000, channels = 1, bits = 16, tag = 1, listBytes } = options;
  const samples = Math.round((ms / 1000) * rate) * channels;
  const data = new Uint8Array(samples * 2);
  const pcm = new DataView(data.buffer);
  for (let i = 0; i < samples; i++)
    pcm.setInt16(i * 2, Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * level * 32767), true);
  const list = listBytes === undefined ? new Uint8Array(0) : chunk('LIST', new Uint8Array(listBytes));
  const fmt = new Uint8Array(16);
  const f = new DataView(fmt.buffer);
  f.setUint16(0, tag, true);
  f.setUint16(2, channels, true);
  f.setUint32(4, rate, true);
  f.setUint32(8, rate * channels * 2, true);
  f.setUint16(12, channels * 2, true);
  f.setUint16(14, bits, true);
  return riff([list, chunk('fmt ', fmt), chunk('data', data)]);
}

/** One RIFF chunk: its id, size and body, padded to an even length. */
export function chunk(id: string, body: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(8 + body.length + (body.length % 2));
  out.set(ascii(id), 0);
  new DataView(out.buffer).setUint32(4, body.length, true);
  out.set(body, 8);
  return out;
}

/** `RIFF <size> WAVE` and the chunks. */
export function riff(chunks: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const size = chunks.reduce((sum, c) => sum + c.length, 0);
  const out = new Uint8Array(12 + size);
  out.set(ascii('RIFF'), 0);
  new DataView(out.buffer).setUint32(4, 4 + size, true);
  out.set(ascii('WAVE'), 8);
  let at = 12;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

const ascii = (text: string) => Uint8Array.from(text, (ch) => ch.charCodeAt(0));

/** whisper-server's `verbose_json` for "Hello there." with a blank-audio segment and DTW times on the words. */
export const SERVER_JSON = {
  task: 'transcribe',
  segments: [
    {
      text: ' Hello there.',
      start: 0,
      end: 1.2,
      words: [
        { word: ' Hello', start: 0.1, end: 0.5, t_dtw: 12 },
        { word: ' there', start: 0.5, end: 0.9, t_dtw: -1 },
        { word: '.', start: 0.9, end: 1.0, t_dtw: 95 },
      ],
    },
    { text: ' [BLANK_AUDIO]', start: 1.2, end: 2, words: [{ word: ' [BLANK_AUDIO]', start: 1.2, end: 2 }] },
  ],
};

/** whisper-cli's `-ojf` file for "Hi, again." with timing tokens and a noise token. */
export const CLI_JSON = {
  transcription: [
    {
      text: ' Hi, again. (music)',
      offsets: { from: 0, to: 1500 },
      tokens: [
        { text: '[_BEG_]', offsets: { from: 0, to: 0 }, t_dtw: -1 },
        { text: ' Hi', offsets: { from: 0, to: 300 }, t_dtw: 5 },
        { text: ',', offsets: { from: 300, to: 320 }, t_dtw: 31 },
        { text: ' again', offsets: { from: 400, to: 900 }, t_dtw: -1 },
        { text: '.', offsets: { from: 900, to: 950 } },
        { text: ' (music)', offsets: { from: 1000, to: 1500 } },
        { text: '[_TT_75]', offsets: { from: 1500, to: 1500 } },
      ],
    },
  ],
};
