import type { ComponentPropsWithRef } from 'react';

export type ButtonTone = 'primary' | 'secondary' | 'danger' | 'quiet';

const TONES: Readonly<Record<ButtonTone, string>> = {
  primary: 'border-amber bg-amber text-ground hover:brightness-110',
  secondary: 'border-line-2 bg-transparent text-ink-2 hover:bg-panel-2 hover:text-ink',
  danger: 'border-alarm bg-alarm text-ground hover:brightness-110',
  quiet: 'border-transparent bg-transparent text-dim hover:bg-panel-2 hover:text-ink',
};

const SIZES = { md: 'min-h-9 px-3.5 py-1.5 text-[13.5px]', sm: 'min-h-7 px-2.5 py-1 text-[12.5px]' } as const;

export interface ButtonProps extends ComponentPropsWithRef<'button'> {
  readonly tone?: ButtonTone;
  readonly size?: keyof typeof SIZES;
  /** Shows a spinner and disables the button while an action runs. */
  readonly busy?: boolean;
}

/** The one button: a primary action, a secondary one, a destructive one or a quiet one. */
export function Button({
  tone = 'secondary',
  size = 'md',
  busy = false,
  disabled,
  className = '',
  type = 'button',
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={`inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-sm border font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-55 ${SIZES[size]} ${TONES[tone]} ${className}`}
      {...rest}
    >
      {busy && <Spinner />}
      {children}
    </button>
  );
}

/** A small spinner in the current text colour (it stands still when reduced motion is asked for). */
export function Spinner({ className = 'size-3.5' }: { readonly className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className={`${className} motion-safe:animate-spin`}
      fill="none"
    >
      <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
      <path d="M14.5 8A6.5 6.5 0 0 0 8 1.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
