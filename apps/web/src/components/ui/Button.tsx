import type { LucideIcon } from 'lucide-react';
import type { ComponentPropsWithRef, ReactNode } from 'react';
import { Link } from '../../app/router.tsx';
import { cx } from '../cx.ts';

/**
 * `primary` is the one blue action of a view, `secondary` a white pill, `soft` a tinted one, `quiet` text only,
 * `danger` destructive; `inverse` and `inverse-soft` sit on the gradient cards (white, and translucent white).
 */
export type ButtonTone = 'primary' | 'secondary' | 'soft' | 'quiet' | 'danger' | 'inverse' | 'inverse-soft';
export type ButtonSize = 'sm' | 'md' | 'lg';

const TONES: Readonly<Record<ButtonTone, string>> = {
  primary: 'bg-blue text-on-blue shadow-primary hover:bg-blue-strong',
  secondary: 'bg-surface text-ink ring-1 ring-line-2 ring-inset hover:bg-surface-2',
  soft: 'bg-blue-soft text-blue hover:bg-blue/20',
  quiet: 'bg-transparent text-dim hover:bg-surface-3 hover:text-ink',
  danger: 'bg-failed text-white hover:brightness-95',
  inverse:
    'bg-white text-[var(--card-accent,var(--blue-strong))] shadow-[0_10px_24px_-10px_rgba(0,0,0,0.4)] hover:bg-white/92',
  'inverse-soft': 'bg-white/15 text-white ring-1 ring-white/25 ring-inset backdrop-blur-sm hover:bg-white/25',
};

const SIZES: Readonly<Record<ButtonSize, string>> = {
  sm: 'h-8 px-3.5 text-sm gap-1.5',
  md: 'h-10 px-4.5 text-sm gap-2',
  lg: 'h-11 px-5 text-base gap-2',
};

const ICON: Readonly<Record<ButtonSize, number>> = { sm: 15, md: 16, lg: 18 };

const BASE =
  'inline-flex shrink-0 cursor-pointer items-center justify-center rounded-full font-semibold whitespace-nowrap transition-[background-color,color,box-shadow,transform,filter] duration-150 select-none active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100';

export interface ButtonProps extends ComponentPropsWithRef<'button'> {
  readonly tone?: ButtonTone;
  readonly size?: ButtonSize;
  /** A leading icon; `trailingIcon` an icon after the words. */
  readonly icon?: LucideIcon;
  readonly trailingIcon?: LucideIcon;
  /** Shows a spinner and disables the button while an action runs. */
  readonly busy?: boolean;
}

/** The one button: a pill, in a tone and a size, with an optional icon and a busy state. */
export function Button({
  tone = 'secondary',
  size = 'md',
  icon: Icon,
  trailingIcon: Trailing,
  busy = false,
  disabled,
  className,
  type = 'button',
  children,
  ...rest
}: ButtonProps) {
  const iconSize = ICON[size];
  return (
    <button
      type={type}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={cx(BASE, SIZES[size], TONES[tone], className)}
      {...rest}
    >
      {busy ? (
        <Spinner size={iconSize} />
      ) : (
        Icon && <Icon size={iconSize} strokeWidth={2.25} aria-hidden="true" />
      )}
      {children}
      {Trailing && !busy && <Trailing size={iconSize} strokeWidth={2.25} aria-hidden="true" />}
    </button>
  );
}

/** A link that looks like a button: in-app through the router, or a plain anchor with `external` (the API docs). */
export function ButtonLink({
  href,
  external = false,
  tone = 'secondary',
  size = 'md',
  icon: Icon,
  trailingIcon: Trailing,
  className,
  children,
}: {
  readonly href: string;
  readonly external?: boolean;
  readonly tone?: ButtonTone;
  readonly size?: ButtonSize;
  readonly icon?: LucideIcon;
  readonly trailingIcon?: LucideIcon;
  readonly className?: string;
  readonly children: ReactNode;
}) {
  const classes = cx(BASE, SIZES[size], TONES[tone], className);
  const iconSize = ICON[size];
  const body = (
    <>
      {Icon && <Icon size={iconSize} strokeWidth={2.25} aria-hidden="true" />}
      {children}
      {Trailing && <Trailing size={iconSize} strokeWidth={2.25} aria-hidden="true" />}
    </>
  );
  if (external) {
    return (
      <a href={href} className={classes}>
        {body}
      </a>
    );
  }
  return (
    <Link to={href} className={classes}>
      {body}
    </Link>
  );
}

/** A small spinner in the current text colour (it stands still when reduced motion is asked for). */
export function Spinner({ size = 16, className }: { readonly size?: number; readonly className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      width={size}
      height={size}
      className={cx('shrink-0 motion-safe:animate-spin', className)}
      fill="none"
    >
      <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
      <path d="M14.5 8A6.5 6.5 0 0 0 8 1.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
