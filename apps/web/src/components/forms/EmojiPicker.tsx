import { isAgentEmoji } from '@mwc/shared/agent-icons';
import { type KeyboardEvent, useId, useRef, useState } from 'react';
import { cx } from '../cx.ts';
import { Input } from './Input.tsx';

/** A curated grid of work-ish emoji: roles, tools, things that ship, and a few friendly faces. */
export const WORK_EMOJI: readonly string[] = [
  '🤖 🧠 👩‍💻 👨‍💻 🧑‍🔬 🧑‍🎨 🧑‍🏫 🧑‍💼',
  '🕵️ 🦾 👾 🛠️ 🔧 🔨 ⚙️ 🧰',
  '🧪 🔬 🔭 🧭 🗺️ 📐 📏 🧮',
  '💻 🖥️ ⌨️ 🖱️ 📱 🔌 💾 🗄️',
  '📊 📈 📉 📋 📝 ✏️ 🖊️ 📚',
  '📦 🚚 🚀 🛰️ ⚡ 🔥 💡 🎯',
  '✅ 🔍 🐛 🛡️ 🔒 🔑 📣 💬',
  '🦉 🦊 🐙 🐝 🦄 🐢 🌟 🍀',
]
  .join(' ')
  .split(' ');

const COLUMNS = 8;

/** Arrow keys move through the grid (rows of `COLUMNS`), wrapping at its ends. */
function nextIndex(key: string, index: number, count: number): number | undefined {
  const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: COLUMNS, ArrowUp: -COLUMNS }[key];
  return step === undefined ? undefined : (index + step + count) % count;
}

/** The free field: any one emoji, typed or pasted; anything else is pointed out and not taken. */
function OtherEmoji({
  value,
  onChange,
  disabled,
}: {
  readonly value: string;
  readonly onChange: (emoji: string) => void;
  readonly disabled: boolean;
}) {
  const id = useId();
  const [text, setText] = useState(WORK_EMOJI.includes(value) ? '' : value);
  const trimmed = text.trim();
  const wrong = trimmed !== '' && !isAgentEmoji(trimmed);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label htmlFor={id} className="text-xs font-semibold text-dim">
        Any other
      </label>
      <Input
        id={id}
        size="sm"
        value={text}
        disabled={disabled}
        placeholder="Paste one emoji"
        aria-invalid={wrong || undefined}
        aria-describedby={wrong ? `${id}-error` : undefined}
        onChange={(event) => {
          setText(event.target.value);
          const next = event.target.value.trim();
          if (isAgentEmoji(next)) onChange(next);
        }}
        className="w-36"
      />
      {wrong && (
        <span id={`${id}-error`} className="text-xs font-medium text-failed">
          One emoji only
        </span>
      )}
    </div>
  );
}

/**
 * Pick one emoji: a compact grid of work-ish ones (a radio group; arrow keys move the choice) and a field for any other
 * (one grapheme, as the server checks it with `isAgentEmoji`). No emoji library: the grid is a curated list.
 */
export function EmojiPicker({
  value,
  onChange,
  label = 'Emoji',
  disabled = false,
  className,
}: {
  /** The chosen emoji; empty for none yet. */
  readonly value: string;
  readonly onChange: (emoji: string) => void;
  readonly label?: string;
  readonly disabled?: boolean;
  readonly className?: string;
}) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const chosen = WORK_EMOJI.indexOf(value);
  const move = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next = nextIndex(event.key, index, WORK_EMOJI.length);
    if (next === undefined) return;
    event.preventDefault();
    onChange(WORK_EMOJI[next] ?? value);
    buttons.current[next]?.focus();
  };
  return (
    <div className={cx('flex flex-col gap-2.5', className)}>
      <div role="radiogroup" aria-label={label} className="grid w-fit grid-cols-8 gap-1">
        {WORK_EMOJI.map((emoji, index) => (
          // biome-ignore lint/a11y/useSemanticElements: the ARIA radio pattern on buttons, so each choice is an emoji.
          <button
            key={emoji}
            ref={(element) => {
              buttons.current[index] = element;
            }}
            type="button"
            role="radio"
            aria-checked={emoji === value}
            aria-label={emoji}
            tabIndex={index === Math.max(0, chosen) ? 0 : -1}
            disabled={disabled}
            onClick={() => onChange(emoji)}
            onKeyDown={(event) => move(event, index)}
            className={cx(
              'flex size-9 cursor-pointer items-center justify-center rounded-lg text-xl leading-none transition-colors duration-150 disabled:cursor-not-allowed',
              emoji === value ? 'bg-teal-soft ring-2 ring-teal' : 'hover:bg-surface-3',
            )}
          >
            {emoji}
          </button>
        ))}
      </div>
      <OtherEmoji value={value} onChange={onChange} disabled={disabled} />
    </div>
  );
}
