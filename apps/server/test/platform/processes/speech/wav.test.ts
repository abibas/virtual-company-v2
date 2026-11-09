import { describe, expect, it } from 'vitest';
import {
  clipMs,
  MIN_VOICE_MS,
  readWav,
  SPEECH_MAX_MS,
  voicedMs,
  writeWav,
} from '../../../../src/platform/processes/speech/wav.ts';
import { chunk, riff, wavClip } from '../../../fixtures/speech/clips.ts';

const samplesOf = (bytes: Uint8Array) => {
  const read = readWav(bytes);
  if (!read.ok) throw new Error(read.reason);
  return read.pcm;
};

describe('readWav', () => {
  it('reads the samples of a 16 kHz mono 16-bit WAV, skipping other chunks (odd sizes padded)', () => {
    const plain = samplesOf(wavClip(500));
    expect(plain.length).toBe(8000);
    expect(clipMs(plain)).toBe(500);
    const withList = samplesOf(wavClip(500, { listBytes: 7 }));
    expect(withList).toEqual(plain);
  });

  it('refuses what is not a RIFF/WAVE file, or has no format or data chunk', () => {
    expect(readWav(new Uint8Array(4))).toEqual({ ok: false, reason: 'not_wav' });
    expect(readWav(new TextEncoder().encode('RIFF....AVI LIST'))).toEqual({ ok: false, reason: 'not_wav' });
    expect(readWav(riff([chunk('fmt ', new Uint8Array(16))]))).toEqual({ ok: false, reason: 'not_wav' });
    expect(readWav(riff([chunk('data', new Uint8Array(32))]))).toEqual({ ok: false, reason: 'not_wav' });
  });

  it('refuses another rate, stereo, 8 bits or a format that is not PCM', () => {
    for (const options of [{ rate: 44_100 }, { channels: 2 }, { bits: 8 }, { tag: 3 }])
      expect(readWav(wavClip(100, options))).toEqual({ ok: false, reason: 'not_wav' });
  });

  it('takes a clip a moment past two minutes and refuses a longer one', () => {
    expect(readWav(wavClip(SPEECH_MAX_MS + 1_000, { level: 0 })).ok).toBe(true);
    expect(readWav(wavClip(SPEECH_MAX_MS + 3_000, { level: 0 }))).toEqual({ ok: false, reason: 'too_long' });
  });
});

describe('voicedMs', () => {
  it('counts the 20 ms frames louder than -42 dBFS', () => {
    expect(voicedMs(samplesOf(wavClip(1_000)))).toBe(1_000);
    expect(voicedMs(samplesOf(wavClip(1_000, { level: 0 })))).toBe(0);
    expect(voicedMs(samplesOf(wavClip(1_000, { level: 0.001 })))).toBe(0);
    expect(voicedMs(samplesOf(wavClip(MIN_VOICE_MS - 20)))).toBeLessThan(MIN_VOICE_MS);
  });
});

describe('writeWav', () => {
  it('writes a plain WAV that reads back to the same samples', () => {
    const pcm = samplesOf(wavClip(250, { listBytes: 10 }));
    const written = writeWav(pcm);
    expect(written.length).toBe(44 + pcm.byteLength);
    expect(new TextDecoder().decode(written.subarray(0, 4))).toBe('RIFF');
    expect(samplesOf(written)).toEqual(pcm);
  });
});
