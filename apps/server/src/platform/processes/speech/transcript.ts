/**
 * whisper.cpp's answers as dictation's text and words (docs/speech.md): whisper-server's `verbose_json` (segments with
 * their words, in seconds) and whisper-cli's `-ojf` file (segments with their tokens, offsets in ms). Noise tokens
 * (`[BLANK_AUDIO]`, `(music)`) are dropped, and a word starts at its DTW time when whisper.cpp aligned one (the plain
 * offsets often put a word next to a pause on the wrong side). Pure.
 */

/** One word of the text, with its start and end in the clip, in milliseconds. */
export interface SpeechWord {
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

export interface SpeechText {
  readonly text: string;
  readonly words: readonly SpeechWord[];
}

/** A token as whisper.cpp gives it: its text (a leading space opens a word), offsets in ms, its DTW time (cs) or -1. */
interface Token {
  readonly text: string;
  readonly from: number;
  readonly to: number;
  readonly dtwCs: number;
}

interface Parsed {
  readonly segments: readonly string[];
  readonly tokens: readonly Token[];
}

const NOISE_WORD = /^[[(](BLANK_AUDIO|MUSIC|NOISE|SILENCE|INAUDIBLE)/i;
const NOISE =
  /\[(BLANK_AUDIO|MUSIC|NOISE|SILENCE|INAUDIBLE)[^\]]*\]|\((silence|inaudible|music|noise)[^)]*\)/gi;
/** `[_BEG_]`, `[_TT_42]`: timing tokens, not text. */
const TIMING_TOKEN = /^\[_[A-Z]+_?\d*\]$/;

const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);
const dtw = (value: unknown): number => (typeof value === 'number' ? value : -1);
const str = (value: unknown): string => (typeof value === 'string' ? value : '');

function clean(text: string): string {
  return text.replace(NOISE, ' ').replace(/\s+/g, ' ').trim();
}

/** Tokens to words: a token with a leading space (or the first) opens a word, the others join the last one. */
function wordsOf(tokens: readonly Token[]): SpeechWord[] {
  const words: { text: string; start: number; end: number }[] = [];
  for (const token of tokens) {
    if (TIMING_TOKEN.test(token.text)) continue;
    const start = token.dtwCs >= 0 ? token.dtwCs * 10 : token.from;
    const last = words.at(-1);
    if (last === undefined || /^\s/.test(token.text))
      words.push({ text: token.text.trim(), start, end: Math.max(start, token.to) });
    else {
      last.text += token.text;
      last.end = Math.max(last.end, token.to);
    }
  }
  return words.filter((word) => word.text !== '' && !NOISE_WORD.test(word.text));
}

function toText(parsed: Parsed): SpeechText {
  return { text: clean(parsed.segments.join(' ')), words: wordsOf(parsed.tokens) };
}

/** whisper-server's `verbose_json`: `segments[].text` and `segments[].words[]` (`word`, `start`, `end` in s, `t_dtw`). */
export function fromServerJson(json: unknown): SpeechText {
  const segments: string[] = [];
  const tokens: Token[] = [];
  for (const segment of list((json as { segments?: unknown } | null)?.segments)) {
    const s = segment as { text?: unknown; words?: unknown };
    segments.push(str(s.text));
    for (const word of list(s.words)) {
      const w = word as { word?: unknown; start?: unknown; end?: unknown; t_dtw?: unknown };
      tokens.push({
        text: str(w.word),
        from: Math.round(num(w.start) * 1000),
        to: Math.round(num(w.end) * 1000),
        dtwCs: dtw(w.t_dtw),
      });
    }
  }
  return toText({ segments, tokens });
}

/** whisper-cli's `-ojf` file: `transcription[].text` and `transcription[].tokens[]` (`text`, `offsets` in ms, `t_dtw`). */
export function fromCliJson(json: unknown): SpeechText {
  const segments: string[] = [];
  const tokens: Token[] = [];
  for (const segment of list((json as { transcription?: unknown } | null)?.transcription)) {
    const s = segment as { text?: unknown; tokens?: unknown };
    segments.push(str(s.text));
    for (const token of list(s.tokens)) {
      const t = token as { text?: unknown; offsets?: { from?: unknown; to?: unknown }; t_dtw?: unknown };
      tokens.push({
        text: str(t.text),
        from: num(t.offsets?.from),
        to: num(t.offsets?.to),
        dtwCs: dtw(t.t_dtw),
      });
    }
  }
  return toText({ segments, tokens });
}

/** whisper.cpp's DTW presets; a model outside them is transcribed without word alignment. */
const DTW_PRESETS = new Set([
  'tiny',
  'tiny.en',
  'base',
  'base.en',
  'small',
  'small.en',
  'medium',
  'medium.en',
  'large.v1',
  'large.v2',
  'large.v3',
  'large.v3.turbo',
]);

/**
 * The word alignment arguments for a model file: `ggml-large-v3-turbo-q5_0.bin` is the preset `large.v3.turbo`, with
 * flash attention off (whisper.cpp aligns only without it); none for a model whisper.cpp has no preset for.
 */
export function alignmentArgs(model: string): string[] {
  const name = model.split('/').at(-1) ?? '';
  const preset = name
    .replace(/^ggml-/, '')
    .replace(/\.bin$/, '')
    .replace(/-q\d+_\d+$/, '')
    .replace(/-/g, '.');
  return DTW_PRESETS.has(preset) ? ['-dtw', preset, '-nfa'] : [];
}
