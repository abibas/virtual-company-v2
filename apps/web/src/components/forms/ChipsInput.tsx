import { X } from 'lucide-react';
import { type KeyboardEvent, useState } from 'react';
import { cx } from '../cx.ts';

/**
 * A short list typed as chips (repositories, project keys): Enter, a comma or leaving the field adds what is typed (a
 * few at once, split on spaces and commas), each chip's × removes it, and Backspace in the empty field removes the last.
 * An entry `valid` refuses stays in the field, marked invalid; one already listed is not added twice.
 */
export function ChipsInput({
  label,
  values,
  onChange,
  valid = () => true,
  normalize = (entry) => entry.trim(),
  placeholder,
  disabled = false,
  className,
}: {
  /** What the list is, for screen readers. */
  readonly label: string;
  readonly values: readonly string[];
  readonly onChange: (values: string[]) => void;
  readonly valid?: ((entry: string) => boolean) | undefined;
  readonly normalize?: ((entry: string) => string) | undefined;
  readonly placeholder?: string | undefined;
  readonly disabled?: boolean | undefined;
  readonly className?: string | undefined;
}) {
  const [draft, setDraft] = useState('');
  const [invalid, setInvalid] = useState(false);
  const add = () => {
    const entries = draft
      .split(/[\s,]+/)
      .map(normalize)
      .filter((entry) => entry !== '');
    if (entries.some((entry) => !valid(entry))) {
      setInvalid(true);
      return;
    }
    setDraft('');
    const added = entries.filter(
      (entry, index) => !values.includes(entry) && entries.indexOf(entry) === index,
    );
    if (added.length > 0) onChange([...values, ...added]);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      add();
    } else if (event.key === 'Backspace' && draft === '' && values.length > 0) {
      onChange(values.slice(0, -1));
    }
  };
  return (
    <div
      className={cx(
        'flex min-h-10 w-full min-w-0 flex-wrap items-center gap-1.5 rounded-md bg-surface-2 px-2 py-1.5 ring-1 ring-transparent ring-inset transition-[box-shadow,background-color] duration-150 focus-within:bg-surface focus-within:ring-blue',
        invalid && 'ring-failed focus-within:ring-failed',
        disabled && 'opacity-60',
        className,
      )}
    >
      {values.map((value) => (
        <span
          key={value}
          className="inline-flex max-w-full items-center gap-1 rounded-full bg-surface py-0.5 pr-1 pl-2.5 font-mono text-xs font-semibold text-ink-2 ring-1 ring-line"
        >
          <span className="truncate">{value}</span>
          <button
            type="button"
            aria-label={`Remove ${value}`}
            disabled={disabled}
            onClick={() => onChange(values.filter((entry) => entry !== value))}
            className="grid size-4 shrink-0 place-items-center rounded-full text-faint hover:bg-surface-3 hover:text-ink focus-visible:text-ink disabled:cursor-not-allowed"
          >
            <X size={11} strokeWidth={2.5} aria-hidden="true" />
          </button>
        </span>
      ))}
      <input
        aria-label={label}
        aria-invalid={invalid || undefined}
        value={draft}
        disabled={disabled}
        placeholder={values.length === 0 ? placeholder : undefined}
        onChange={(event) => {
          setDraft(event.target.value);
          setInvalid(false);
        }}
        onKeyDown={onKeyDown}
        onBlur={add}
        className="h-7 min-w-28 flex-1 bg-transparent px-1 font-mono text-sm text-ink placeholder:font-sans placeholder:text-faint focus:outline-none disabled:cursor-not-allowed"
      />
    </div>
  );
}
