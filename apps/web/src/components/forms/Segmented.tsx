import type { LucideIcon } from 'lucide-react';
import { type KeyboardEvent, useRef } from 'react';
import { Link } from '../../app/router.tsx';
import { cx } from '../cx.ts';

export interface SegmentOption<T extends string> {
  readonly value: T;
  readonly label: string;
  readonly icon?: LucideIcon;
}

const FRAME = 'inline-flex items-center gap-0.5 rounded-full bg-surface-3 p-1';
const SEGMENT =
  'inline-flex cursor-pointer items-center gap-1.5 rounded-full font-semibold whitespace-nowrap transition-[background-color,color,box-shadow] duration-150';
const SIZES = { sm: 'h-7 px-3 text-xs', md: 'h-8 px-3.5 text-sm' } as const;
const ON = 'bg-surface text-ink shadow-card';
const OFF = 'text-dim hover:text-ink';

/** Arrow keys move between the segments of a group (the one focused is the one selected). */
function moveWithArrows(
  event: KeyboardEvent<HTMLElement>,
  count: number,
  index: number,
  pick: (i: number) => void,
) {
  const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
  if (step === undefined) return;
  event.preventDefault();
  pick((index + step + count) % count);
}

/** One choice among a few, as a pill group: a view, a period, a filter. Arrow keys move the choice. */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
  size = 'md',
  className,
}: {
  readonly options: readonly SegmentOption<T>[];
  readonly value: T;
  readonly onChange: (value: T) => void;
  /** What the choice is about, for screen readers. */
  readonly label: string;
  readonly size?: keyof typeof SIZES;
  readonly className?: string;
}) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const pick = (index: number) => {
    const option = options[index];
    if (!option) return;
    onChange(option.value);
    buttons.current[index]?.focus();
  };
  return (
    <div role="radiogroup" aria-label={label} className={cx(FRAME, className)}>
      {options.map((option, index) => {
        const on = option.value === value;
        const Icon = option.icon;
        return (
          // biome-ignore lint/a11y/useSemanticElements: the ARIA radio pattern on buttons, so a choice can hold an icon or a face and keep the pill look.
          <button
            key={option.value}
            ref={(element) => {
              buttons.current[index] = element;
            }}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => moveWithArrows(event, options.length, index, pick)}
            className={cx(SEGMENT, SIZES[size], on ? ON : OFF)}
          >
            {Icon && <Icon size={14} strokeWidth={2.25} aria-hidden="true" />}
            {option.label}
          </button>
        );
      })}
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
