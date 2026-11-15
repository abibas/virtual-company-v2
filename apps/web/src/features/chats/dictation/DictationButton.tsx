import { Mic, Square } from 'lucide-react';
import { usePublicConfig } from '../../../api/config.ts';
import { cx } from '../../../components/cx.ts';
import { Spinner } from '../../../components/ui/Button.tsx';
import { iconButtonClass } from '../../../components/ui/IconButton.tsx';
import { MicPicker } from './MicPicker.tsx';
import type { Dictation, DictationState } from './use-dictation.ts';

/**
 * The composer's microphone (S5.2, docs/speech.md): click, or Alt+Shift+V in the composer, to dictate; click again or
 * Esc to stop. While it listens, a level meter and the time; then the server's computer transcribes the clip and the
 * text goes in at the cursor of the composer's message box, not sent (a Send meanwhile stops it and sends the words,
 * T-32). Beside it, the microphone picker (the default one, or the one chosen, remembered in this browser). Hidden when
 * the server does not transcribe (`speech: false`).
 */

/** 75 s → `1:15`. */
const clock = (ms: number) => {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};

/**
 * Starts in line with the message text above (T-33): the composer's bottom row is padded `px-1.5` (`@sm/composer:px-2`)
 * and its message box `px-4.5`, so this makes up the difference.
 */
const inLine = 'pl-3 @sm/composer:pl-2.5';

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
        <span className={cx(inLine, 'flex items-center gap-1.5 text-xs text-dim tabular-nums')} aria-hidden="true">
          <span className="h-1.5 w-10 overflow-hidden rounded-full bg-surface-3">
            <span
              className="block h-full origin-left rounded-full bg-blue transition-transform duration-75"
              style={{ transform: `scaleX(${Math.max(0.04, level)})` }}
            />
          </span>
          {clock(elapsedMs)}
        </span>
      )}
      {state === 'transcribing' && <span className={cx(inLine, 'text-xs text-dim')}>Transcribing…</span>}
    </>
  );
}

export function DictationButton({
  dictation,
}: {
  /** The composer's dictation (`useComposerDictation`): the dictated text goes in at its message box's cursor. */
  readonly dictation: Dictation;
}) {
  const { speech } = usePublicConfig();
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
    <div className="relative flex h-9 shrink-0 items-center gap-0.5">
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
