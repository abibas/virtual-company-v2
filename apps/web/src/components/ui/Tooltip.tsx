import type { ReactNode } from 'react';
import { cx } from '../cx.ts';

/** Where the label shows; `bottom-end` hangs below and to the left, for a mark in a card's top right corner. */
export type TooltipSide = 'top' | 'right' | 'bottom' | 'left' | 'bottom-end';

const SIDES: Readonly<Record<TooltipSide, string>> = {
  top: 'bottom-full left-1/2 mb-2 -translate-x-1/2',
  right: 'top-1/2 left-full ml-2.5 -translate-y-1/2',
  bottom: 'top-full left-1/2 mt-2 -translate-x-1/2',
  left: 'top-1/2 right-full mr-2.5 -translate-y-1/2',
  'bottom-end': 'top-full right-0 mt-2',
};

/**
 * A small label that appears on hover and keyboard focus of its one child. The child carries its own accessible
 * name (an `aria-label`), so the tooltip is a visual echo, hidden from screen readers.
 */
export function Tooltip({
  label,
  side = 'top',
  wrap = false,
  children,
}: {
  readonly label: string;
  readonly side?: TooltipSide;
  /** A longer label on a few lines (at most 14rem wide), for a tight spot such as a card's corner. */
  readonly wrap?: boolean;
  readonly children: ReactNode;
}) {
  return (
    <span className="group/tip relative inline-flex">
      {children}
      <span
        aria-hidden="true"
        className={cx(
          'pointer-events-none absolute z-40 rounded-md bg-ink px-2.5 py-1.5 text-xs font-medium text-canvas opacity-0 shadow-float transition-opacity duration-150 group-focus-within/tip:opacity-100 group-hover/tip:opacity-100',
          wrap ? 'w-max max-w-56 whitespace-normal' : 'whitespace-nowrap',
          SIDES[side],
        )}
      >
        {label}
      </span>
    </span>
  );
}
