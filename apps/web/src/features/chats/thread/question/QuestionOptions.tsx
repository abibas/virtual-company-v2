import { Check, Search } from 'lucide-react';
import { type KeyboardEvent, useId } from 'react';
import type { AskQuestion } from '../../../../api/types.ts';
import { cx } from '../../../../components/cx.ts';

/**
 * One question's choices (S5.2 step 4): a row per option with its key (1–9), its label and its one-line description,
 * and its mark: a ring that fills for a single choice (a radio group), a box that checks for several (a group of
 * checkboxes). Up and Down move between the rows; a filter shows over 6 options and narrows them by label or
 * description.
 */

type Option = AskQuestion['options'][number];

/** The options a filter leaves, with their keys (1–9, in the order shown). */
export function visibleOptions(question: AskQuestion, filter: string): readonly Option[] {
  const words = filter.trim().toLowerCase();
  if (words === '') return question.options;
  return question.options.filter((option) =>
    `${option.label} ${option.description}`.toLowerCase().includes(words),
  );
}

/** More options than this get a filter. */
export const FILTER_FROM = 6;

function Mark({ checked, multi }: { readonly checked: boolean; readonly multi: boolean }) {
  if (multi) {
    return (
      <span
        className={cx(
          'inline-flex size-4.5 shrink-0 items-center justify-center rounded-[5px] ring-[1.5px] ring-inset transition-colors',
          checked ? 'bg-blue text-on-blue ring-blue' : 'ring-line-2',
        )}
      >
        {checked && <Check size={12} strokeWidth={3.25} aria-hidden="true" />}
      </span>
    );
  }
  return (
    <span
      className={cx(
        'inline-flex size-4.5 shrink-0 items-center justify-center rounded-full ring-inset transition-[box-shadow]',
        checked ? 'ring-[5px] ring-blue' : 'ring-[1.5px] ring-line-2',
      )}
    />
  );
}

/** The list's role: a radio group for one pick, a group of checkboxes for several (named by the question). */
const groupProps = (multi: boolean, name: string) =>
  multi ? { role: 'group', 'aria-label': name } : { role: 'radiogroup', 'aria-label': name };

/** A row's role and state: a radio or a checkbox, checked or not. */
const choiceProps = (multi: boolean, checked: boolean) =>
  ({ role: multi ? 'checkbox' : 'radio', 'aria-checked': checked }) as const;

/** Up and Down move the focus between the rows of a list. */
function moveFocus(event: KeyboardEvent<HTMLDivElement>) {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
  const rows = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[data-option]')];
  const at = rows.indexOf(document.activeElement as HTMLButtonElement);
  if (at < 0) return;
  event.preventDefault();
  rows[(at + (event.key === 'ArrowDown' ? 1 : rows.length - 1)) % rows.length]?.focus();
}

/** One choice: its key, its label and description, its mark. */
function OptionRow({
  option,
  index,
  checked,
  multi,
  disabled,
  onPick,
}: {
  readonly option: Option;
  readonly index: number;
  readonly checked: boolean;
  readonly multi: boolean;
  readonly disabled: boolean;
  readonly onPick: (label: string) => void;
}) {
  return (
    <button
      {...choiceProps(multi, checked)}
      type="button"
      data-option=""
      disabled={disabled}
      onClick={() => onPick(option.label)}
      className={cx(
        'flex w-full min-w-0 cursor-pointer items-start gap-3 rounded-lg px-3 py-2.5 text-left ring-1 ring-inset transition-[background-color,box-shadow] duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue disabled:cursor-not-allowed disabled:opacity-60',
        checked ? 'bg-blue-soft ring-blue/45' : 'bg-surface ring-line hover:bg-surface-2 hover:ring-line-2',
      )}
    >
      <span
        aria-hidden="true"
        className={cx(
          'mt-px inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-sm px-1 text-2xs font-semibold tabular ring-1 ring-inset',
          checked ? 'bg-blue text-on-blue ring-blue' : 'bg-surface-2 text-dim ring-line-2',
        )}
      >
        {index < 9 ? index + 1 : '·'}
      </span>
      <span className="grid min-w-0 flex-1 gap-0.5">
        <span className="text-sm font-semibold break-words text-ink">{option.label}</span>
        {option.description && (
          <span className="text-xs leading-snug break-words text-dim">{option.description}</span>
        )}
      </span>
      <span className="mt-0.5">
        <Mark checked={checked} multi={multi} />
      </span>
    </button>
  );
}

/** The filter over a long list of choices. */
function FilterBox({
  value,
  controls,
  disabled,
  onChange,
}: {
  readonly value: string;
  readonly controls: string;
  readonly disabled: boolean;
  readonly onChange: (filter: string) => void;
}) {
  return (
    <label className="flex h-9 items-center gap-2 rounded-md bg-surface-2 px-3 text-sm ring-1 ring-transparent ring-inset focus-within:bg-surface focus-within:ring-blue">
      <Search size={14} aria-hidden="true" className="shrink-0 text-dim" />
      <input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Filter choices"
        aria-label="Filter choices"
        aria-controls={controls}
        disabled={disabled}
        className="min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-faint [&::-webkit-search-cancel-button]:hidden"
      />
    </label>
  );
}

export function QuestionOptions({
  question,
  picked,
  filter,
  disabled,
  onPick,
  onFilter,
}: {
  readonly question: AskQuestion;
  readonly picked: readonly string[];
  readonly filter: string;
  readonly disabled: boolean;
  readonly onPick: (label: string) => void;
  readonly onFilter: (filter: string) => void;
}) {
  const id = useId();
  const multi = question.multiSelect;
  const shown = visibleOptions(question, filter);
  return (
    <div className="grid gap-2">
      {question.options.length > FILTER_FROM && (
        <FilterBox value={filter} controls={id} disabled={disabled} onChange={onFilter} />
      )}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: a radio group or a group of checkboxes (its role is spread); Up and Down move between its rows. */}
      <div {...groupProps(multi, question.question)} id={id} onKeyDown={moveFocus} className="grid gap-1.5">
        {shown.map((option, index) => (
          <OptionRow
            key={option.label}
            option={option}
            index={index}
            checked={picked.includes(option.label)}
            multi={multi}
            disabled={disabled}
            onPick={onPick}
          />
        ))}
        {shown.length === 0 && (
          <p className="px-1 py-2 text-xs text-dim">No choice matches “{filter.trim()}”.</p>
        )}
      </div>
    </div>
  );
}
