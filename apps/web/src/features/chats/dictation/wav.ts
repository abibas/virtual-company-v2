/**
 * The recorded samples as the clip the server transcribes (docs/speech.md): joined, brought down from the audio
 * graph's rate (44.1 or 48 kHz) to 16 kHz, and written as a mono 16-bit PCM WAV. Pure.
 */

export const CLIP_RATE = 16_000;

/** The chunks one after the other. */
export function joinChunks(chunks: readonly Float32Array[]): Float32Array {
  const out = new Float32Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

/** Averages each run of input samples into one output sample: plenty for speech going to Whisper. */
export function downsample(input: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return input;
  const ratio = from / to;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.max(start + 1, Math.floor((i + 1) * ratio)));
    let sum = 0;
    for (let j = start; j < end; j++) sum += input[j] as number;
    out[i] = sum / (end - start);
  }
  return out;
}

/** A mono 16-bit PCM WAV of the samples (-1..1) at `rate`. */
export function encodeWav(samples: Float32Array, rate: number): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const text = (at: number, value: string) => {
    for (let i = 0; i < value.length; i++) view.setUint8(at + i, value.charCodeAt(i));
  };
  text(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const x = Math.max(-1, Math.min(1, samples[i] as number));
    view.setInt16(44 + i * 2, x < 0 ? x * 0x8000 : x * 0x7fff, true);
  }
  return buffer;
}

/** The chunks recorded at `rate` as a 16 kHz WAV clip. */
export function clipOf(chunks: readonly Float32Array[], rate: number): Blob {
  const samples = downsample(joinChunks(chunks), rate, CLIP_RATE);
  return new Blob([encodeWav(samples, CLIP_RATE)], { type: 'audio/wav' });
}
