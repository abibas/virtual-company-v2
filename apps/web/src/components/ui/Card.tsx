import type { ComponentPropsWithRef } from 'react';
import { cx } from '../cx.ts';

/** `plain` is the white card, `soft` a tinted inset, `hero` the blue gradient, `teal` the teal one, `ink` the dark one. */
export type CardVariant = 'plain' | 'soft' | 'hero' | 'teal' | 'ink';
export type CardPadding = 'none' | 'sm' | 'md' | 'lg';

const VARIANTS: Readonly<Record<CardVariant, string>> = {
  plain: 'bg-surface text-ink shadow-card',
  soft: 'bg-surface-2 text-ink',
  hero: 'gradient-hero text-white shadow-hero [--card-accent:#2347e3]',
  teal: 'gradient-teal text-white shadow-teal [--card-accent:#0b8c7e]',
  ink: 'gradient-ink text-white shadow-raised [--card-accent:#141a33]',
};

const PADDINGS: Readonly<Record<CardPadding, string>> = {
  none: '',
  sm: 'p-4',
  md: 'p-5 md:p-6',
  lg: 'p-6 md:p-7',
};

export interface CardProps extends ComponentPropsWithRef<'div'> {
  readonly variant?: CardVariant;
  readonly padding?: CardPadding;
  /** The element to render: a `section` or `article` when the card is one. */
  readonly as?: 'div' | 'section' | 'article' | 'li';
  /** Lifts on hover, for a card that is a link or a button. */
  readonly interactive?: boolean;
}

/** The surface everything sits on: a large radius, a soft shadow, and the gradient variants for the hero spots. */
export function Card({
  variant = 'plain',
  padding = 'md',
  as = 'div',
  interactive = false,
  className,
  children,
  ...rest
}: CardProps) {
  const Tag = as as 'div';
  return (
    <Tag
      className={cx(
        'relative overflow-hidden rounded-2xl',
        VARIANTS[variant],
        PADDINGS[padding],
        interactive &&
          'transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-raised',
        className,
      )}
      {...rest}
    >
      {children}
    </Tag>
  );
}
