import type { LucideIcon } from 'lucide-react';
import type { ComponentPropsWithRef } from 'react';
import { cx } from '../cx.ts';
import { CountDot, type CountTone } from './CountDot.tsx';
import { Tooltip, type TooltipSide } from './Tooltip.tsx';

export type IconButtonTone = 'ghost' | 'soft' | 'solid' | 'primary' | 'inverse';
export type IconButtonSize = 'sm' | 'md' | 'lg';

const TONES: Readonly<Record<IconButtonTone, string>> = {
  ghost: 'text-dim hover:bg-surface-3 hover:text-ink',
  soft: 'bg-surface-2 text-ink-2 hover:bg-surface-3 hover:text-ink',
  solid: 'bg-surface text-ink-2 shadow-card ring-1 ring-line ring-inset hover:text-ink',
  primary: 'bg-blue text-on-blue shadow-primary hover:bg-blue-strong',
  inverse: 'bg-white/15 text-white ring-1 ring-white/25 ring-inset hover:bg-white/25',
};

const SIZES: Readonly<Record<IconButtonSize, { readonly box: string; readonly icon: number }>> = {
  sm: { box: 'size-8 rounded-md', icon: 16 },
  md: { box: 'size-10 rounded-lg', icon: 18 },
  lg: { box: 'size-11 rounded-lg', icon: 20 },
};

/** The classes of an icon button, for an element that is not a button (a link in the rail). */
export function iconButtonClass({
  tone = 'ghost',
  size = 'md',
  active = false,
  round = false,
  className,
}: {
  readonly tone?: IconButtonTone;
  readonly size?: IconButtonSize;
  readonly active?: boolean;
  readonly round?: boolean;
  readonly className?: string | undefined;
}): string {
  return cx(
    'relative inline-flex shrink-0 cursor-pointer items-center justify-center transition-[background-color,color,box-shadow] duration-150 disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-40',
    SIZES[size].box,
    round && 'rounded-full',
    active ? 'bg-blue text-on-blue shadow-primary' : TONES[tone],
    className,
  );
}

/** The icon size that goes with a button size. */
export const iconSize = (size: IconButtonSize): number => SIZES[size].icon;

export interface IconButtonProps extends Omit<ComponentPropsWithRef<'button'>, 'children'> {
  /** What the button does, for screen readers and the tooltip. */
  readonly label: string;
  readonly icon: LucideIcon;
  readonly tone?: IconButtonTone;
  readonly size?: IconButtonSize;
  /** The selected state (the rail's current page): a filled blue square. */
  readonly active?: boolean;
  /** A count in a dot at the corner (the rail strip's icons), hidden at 0. */
  readonly badge?: number;
  /** The count's dot pulses softly: something waits for the person. */
  readonly pulse?: boolean;
  /** The count's colour: red (`alert`, the default) for what needs the person, blue (`info`) for unread notices. */
  readonly badgeTone?: CountTone;
  /** Shows the label as a tooltip on hover and focus, on this side. */
  readonly tooltip?: TooltipSide;
  readonly round?: boolean;
}

/** A square icon-only button with a label for screen readers; optionally a tooltip and a count badge. */
export function IconButton({
  label,
  icon: Icon,
  tone = 'ghost',
  size = 'md',
  active = false,
  badge,
  pulse = false,
  badgeTone,
  tooltip,
  round = false,
  className,
  type = 'button',
  ...rest
}: IconButtonProps) {
  const button = (
    <button
      type={type}
      aria-label={label}
      aria-pressed={active || undefined}
      className={iconButtonClass({ tone, size, active, round, className })}
      {...rest}
    >
      <Icon size={SIZES[size].icon} strokeWidth={2} aria-hidden="true" />
      <CountDot count={badge ?? 0} pulse={pulse} {...(badgeTone ? { tone: badgeTone } : {})} />
    </button>
  );
  if (!tooltip) return button;
  return (
    <Tooltip label={label} side={tooltip}>
      {button}
    </Tooltip>
  );
}
