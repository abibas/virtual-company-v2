import { Mic, Square } from 'lucide-react';
import { type RefObject, useCallback, useRef } from 'react';
import { usePublicConfig } from '../../../api/config.ts';
import { cx } from '../../../components/cx.ts';
import { Spinner } from '../../../components/ui/Button.tsx';
import { iconButtonClass } from '../../../components/ui/IconButton.tsx';
import { MicPicker } from './MicPicker.tsx';
import { type DictationState, useDictation } from './use-dictation.ts';

/**
 * The composer's microphone (S5.2, docs/speech.md): click, or Alt+Shift+V in the composer, to dictate; click again or
 * Esc to stop. While it listens, a level meter and the time; then the server's computer transcribes the clip and the
 * text goes in at the cursor of the composer's message box, not sent. Beside it, the microphone picker (the default
 * one, or the one chosen, remembered in this browser). Hidden when the server does not transcribe (`speech: false`).
 */

/** 75 s → `1:15`. */
const clock = (ms: number) => {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};

/** The text with a space before and after it where its neighbours need one. */
function spliced(value: string, start: number, end: number, text: string) {
  const before = value.slice(0, start);
  const after = value.slice(end);
  const lead = before !== '' && !/\s$/.test(before) ? ' ' : '';
  const trail = after !== '' && !/^[\s,.;:!?)]/.test(after) ? ' ' : '';
  return {
    next: `${before}${lead}${text}${trail}${after}`,
    caret: before.length + lead.length + text.length,
  };
}

/** Beside the button: the level meter and the time while it listens, "Transcribing…", and a message above it. */
function Status({
  state,
  level,
  elapsedMs,
  error,
}: {
  readonly state: DictationState;
  readonly level: number;
  readonly elapsedMs: number;
  readonly error: string | undefined;
}) {
  return (
    <>
      {error && (
        <p
          role="status"
          className="absolute right-0 bottom-full mb-2 w-64 rounded-lg bg-surface p-2.5 text-xs text-failed shadow-float ring-1 ring-line"
        >
          {error}
        </p>
      )}
      {state === 'recording' && (
        <span className="flex items-center gap-1.5 text-xs text-dim tabular-nums" aria-hidden="true">
          <span className="h-1.5 w-10 overflow-hidden rounded-full bg-surface-3">
            <span
              className="block h-full origin-left rounded-full bg-blue transition-transform duration-75"
              style={{ transform: `scaleX(${Math.max(0.04, level)})` }}
            />
          </span>
          {clock(elapsedMs)}
        </span>
      )}
      {state === 'transcribing' && <span className="text-xs text-dim">Transcribing…</span>}
    </>
  );
}

/** The composer's form (from the button's place) and how text goes in at its message box's cursor. */
function useInsertAtCursor(
  anchor: RefObject<HTMLDivElement | null>,
  value: string,
  onChange: (next: string) => void,
) {
  const valueRef = useRef(value);
  valueRef.current = value;
  const getRoot = useCallback(() => anchor.current?.closest('form') ?? null, [anchor]);
  const insert = useCallback(
    (text: string) => {
      const box = getRoot()?.querySelector('textarea') ?? null;
      const current = valueRef.current;
      const start = box?.selectionStart ?? current.length;
      const { next, caret } = spliced(current, start, box?.selectionEnd ?? start, text);
      const max = box !== null && box.maxLength > 0 ? box.maxLength : next.length;
      onChange(next.slice(0, max));
      requestAnimationFrame(() => {
        box?.focus();
        box?.setSelectionRange(Math.min(caret, max), Math.min(caret, max));
      });
    },
    [getRoot, onChange],
  );
  return { getRoot, insert };
}

export function DictationButton({
  value,
  onChange,
}: {
  /** The message box's text, and its setter: the dictated text goes in at its cursor. */
  readonly value: string;
  readonly onChange: (next: string) => void;
}) {
  const { speech } = usePublicConfig();
  const anchor = useRef<HTMLDivElement>(null);
  const { getRoot, insert } = useInsertAtCursor(anchor, value, onChange);
  const dictation = useDictation({ getRoot, insert });
  if (!speech || !dictation.supported) return null;

  const { state } = dictation;
  const recording = state === 'recording';
  const waiting = state === 'starting' || state === 'transcribing';
  const label = recording
    ? 'Stop dictating (Esc)'
    : state === 'transcribing'
      ? 'Transcribing…'
      : 'Dictate (⌥⇧V)';

  return (
    <div ref={anchor} className="relative flex h-9 shrink-0 items-center gap-0.5">
      <Status state={state} level={dictation.level} elapsedMs={dictation.elapsedMs} error={dictation.error} />
      <button
        type="button"
        aria-label={label}
        aria-pressed={recording}
        title={label}
        disabled={waiting}
        // Keeps the message box's focus and cursor: the text goes in there.
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => void dictation.toggle()}
        className={iconButtonClass({
          size: 'sm',
          round: true,
          className: cx(recording && 'bg-failed-soft text-failed hover:bg-failed-soft hover:text-failed'),
        })}
      >
        {waiting ? (
          <Spinner size={16} />
        ) : recording ? (
          <Square size={14} strokeWidth={2.5} aria-hidden="true" className="fill-current" />
        ) : (
          <Mic size={18} strokeWidth={2} aria-hidden="true" />
        )}
      </button>
      <MicPicker
        mics={dictation.mics}
        mic={dictation.mic}
        disabled={recording}
        onOpen={() => void dictation.refreshMics()}
        onChoose={dictation.chooseMic}
      />
    </div>
  );
}
