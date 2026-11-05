import type { LucideIcon } from 'lucide-react';
import { type KeyboardEvent, useRef } from 'react';
import { Link } from '../../app/router.tsx';
import { cx } from '../cx.ts';

export interface SegmentOption<T extends string> {
  readonly value: T;
  readonly label: string;
  readonly icon?: LucideIcon;
  /** Shown but not choosable (a choice that comes later); arrow keys skip it. */
  readonly disabled?: boolean;
  /** A small word after the label ("later"). */
  readonly note?: string;
}

const FRAME = 'inline-flex items-center gap-0.5 rounded-full bg-surface-3 p-1';
const SEGMENT =
  'inline-flex cursor-pointer items-center gap-1.5 rounded-full font-semibold whitespace-nowrap transition-[background-color,color,box-shadow] duration-150 aria-disabled:cursor-not-allowed';
const SIZES = { sm: 'h-7 px-3 text-xs', md: 'h-8 px-3.5 text-sm' } as const;
const ON = 'bg-surface text-ink shadow-card';
const OFF = 'text-dim hover:text-ink';
const UNAVAILABLE = 'text-faint';

/** The next choosable segment from `index` in the arrow's direction, or `index` when there is none. */
function nextEnabled<T extends string>(options: readonly SegmentOption<T>[], index: number, step: number) {
  for (let i = 1; i <= options.length; i++) {
    const next = (index + step * i + options.length * i) % options.length;
    if (!options[next]?.disabled) return next;
  }
  return index;
}

/** Arrow keys move between the choosable segments of a group (the one focused is the one selected). */
function moveWithArrows<T extends string>(
  event: KeyboardEvent<HTMLElement>,
  options: readonly SegmentOption<T>[],
  index: number,
  pick: (i: number) => void,
) {
  const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
  if (step === undefined) return;
  event.preventDefault();
  pick(nextEnabled(options, index, step));
}

/** One segment: a radio in the ARIA sense, with its icon, label and note. */
function Segment<T extends string>({
  option,
  on,
  locked,
  size,
  onPick,
  onKey,
  buttonRef,
}: {
  readonly option: SegmentOption<T>;
  readonly on: boolean;
  /** The whole control is read-only. */
  readonly locked: boolean;
  readonly size: keyof typeof SIZES;
  readonly onPick: () => void;
  readonly onKey: (event: KeyboardEvent<HTMLButtonElement>) => void;
  readonly buttonRef: (element: HTMLButtonElement | null) => void;
}) {
  const Icon = option.icon;
  const unavailable = option.disabled || locked;
  return (
    // biome-ignore lint/a11y/useSemanticElements: the ARIA radio pattern on buttons, so a choice can hold an icon or a face and keep the pill look.
    <button
      ref={buttonRef}
      type="button"
      role="radio"
      aria-checked={on}
      aria-disabled={unavailable || undefined}
      tabIndex={on ? 0 : -1}
      onClick={unavailable ? undefined : onPick}
      onKeyDown={locked ? undefined : onKey}
      className={cx(SEGMENT, SIZES[size], on ? ON : option.disabled ? UNAVAILABLE : OFF)}
    >
      {Icon && <Icon size={14} strokeWidth={2.25} aria-hidden="true" />}
      {option.label}
      {option.note && <span className="text-2xs font-medium text-faint">{option.note}</span>}
    </button>
  );
}

/** One choice among a few, as a pill group: a view, a period, a filter. Arrow keys move the choice. */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
  size = 'md',
  disabled = false,
  className,
}: {
  readonly options: readonly SegmentOption<T>[];
  readonly value: T;
  readonly onChange: (value: T) => void;
  /** What the choice is about, for screen readers. */
  readonly label: string;
  readonly size?: keyof typeof SIZES;
  /** Shows the choice without letting it change (a read-only view). */
  readonly disabled?: boolean;
  readonly className?: string;
}) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const pick = (index: number) => {
    const option = options[index];
    if (!option || option.disabled) return;
    onChange(option.value);
    buttons.current[index]?.focus();
  };
  return (
    <div
      role="radiogroup"
      aria-label={label}
      aria-disabled={disabled || undefined}
      className={cx(FRAME, disabled && 'opacity-70', className)}
    >
      {options.map((option, index) => (
        <Segment
          key={option.value}
          option={option}
          on={option.value === value}
          locked={disabled}
          size={size}
          onPick={() => onChange(option.value)}
          onKey={(event) => moveWithArrows(event, options, index, pick)}
          buttonRef={(element) => {
            buttons.current[index] = element;
          }}
        />
      ))}
    </div>
  );
}

export interface TabItem {
  readonly href: string;
  readonly label: string;
  readonly current?: boolean;
  readonly icon?: LucideIcon;
}

/** Links to the views of a page, in the same pill group look. */
export function Tabs({
  items,
  label,
  size = 'md',
  className,
}: {
  readonly items: readonly TabItem[];
  readonly label: string;
  readonly size?: keyof typeof SIZES;
  readonly className?: string;
}) {
  return (
    <nav aria-label={label} className={cx(FRAME, className)}>
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            to={item.href}
            aria-current={item.current ? 'page' : undefined}
            className={cx(SEGMENT, SIZES[size], item.current ? ON : OFF)}
          >
            {Icon && <Icon size={14} strokeWidth={2.25} aria-hidden="true" />}
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
