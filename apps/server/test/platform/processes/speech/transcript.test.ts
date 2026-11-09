import { describe, expect, it } from 'vitest';
import {
  alignmentArgs,
  fromCliJson,
  fromServerJson,
} from '../../../../src/platform/processes/speech/transcript.ts';
import { CLI_JSON, SERVER_JSON } from '../../../fixtures/speech/clips.ts';

describe('fromServerJson', () => {
  it("gives whisper-server's text and words in ms, the DTW start when there is one, without [BLANK_AUDIO]", () => {
    expect(fromServerJson(SERVER_JSON)).toEqual({
      text: 'Hello there.',
      words: [
        { text: 'Hello', start: 120, end: 500 },
        { text: 'there.', start: 500, end: 1000 },
      ],
    });
  });

  it('reads an answer of another shape as nothing', () => {
    expect(fromServerJson(null)).toEqual({ text: '', words: [] });
    expect(fromServerJson({ segments: 'no' })).toEqual({ text: '', words: [] });
    expect(fromServerJson({ segments: [{ text: 3, words: [{ word: 7, start: 'x' }] }] })).toEqual({
      text: '',
      words: [],
    });
    expect(fromServerJson({ segments: [{ text: ' [BLANK_AUDIO]' }] })).toEqual({ text: '', words: [] });
  });
});

describe('fromCliJson', () => {
  it("gives whisper-cli's text and words, skipping timing tokens and noise", () => {
    expect(fromCliJson(CLI_JSON)).toEqual({
      text: 'Hi, again.',
      words: [
        { text: 'Hi,', start: 50, end: 320 },
        { text: 'again.', start: 400, end: 950 },
      ],
    });
  });

  it('reads an answer of another shape as nothing', () => {
    expect(fromCliJson({})).toEqual({ text: '', words: [] });
    expect(fromCliJson({ transcription: [{ tokens: [{ text: 'x' }] }] })).toEqual({
      text: '',
      words: [{ text: 'x', start: 0, end: 0 }],
    });
  });
});

describe('alignmentArgs', () => {
  it("aligns words with the model's DTW preset, flash attention off, and not for an unknown model", () => {
    expect(alignmentArgs('/m/ggml-large-v3-turbo-q5_0.bin')).toEqual(['-dtw', 'large.v3.turbo', '-nfa']);
    expect(alignmentArgs('ggml-base.en.bin')).toEqual(['-dtw', 'base.en', '-nfa']);
    expect(alignmentArgs('/m/ggml-distil-whatever.bin')).toEqual([]);
  });
});
