import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from '../../app/router.tsx';
import { cx } from '../cx.ts';
import type { Tone } from '../ui/Badge.tsx';
import { IconTile } from '../ui/IconTile.tsx';

/** Rows, separated by hairlines or by a little air. */
export function List({
  divided = false,
  className,
  children,
}: {
  readonly divided?: boolean;
  readonly className?: string;
  readonly children: ReactNode;
}) {
  return <ul className={cx('flex flex-col', divided && 'divide-y divide-line', className)}>{children}</ul>;
}

export interface ListRowProps {
  /** The tile's icon and tone; `leading` replaces the tile (an avatar). */
  readonly icon?: LucideIcon;
  readonly tone?: Tone;
  readonly leading?: ReactNode;
  readonly title: ReactNode;
  readonly subtitle?: ReactNode;
  /** The bold figure on the right, and its tone. */
  readonly value?: ReactNode;
  readonly valueTone?: Tone;
  /** Under the value: a time, a status word. */
  readonly meta?: ReactNode;
  /** Something else on the right instead of value and meta (controls). */
  readonly trailing?: ReactNode;
  readonly href?: string;
  readonly onClick?: () => void;
  readonly className?: string;
}

const VALUE_TONES: Readonly<Record<Tone, string>> = {
  neutral: 'text-ink',
  blue: 'text-blue',
  teal: 'text-teal',
  input: 'text-input',
  blocked: 'text-blocked',
  review: 'text-review',
  failed: 'text-failed',
  done: 'text-done',
  pending: 'text-pending',
  inverse: 'text-white',
};

/** The row of every list: a tile or avatar, a title with its subtitle, and a value with its meta on the right. */
export function ListRow({
  icon,
  tone = 'neutral',
  leading,
  title,
  subtitle,
  value,
  valueTone = 'neutral',
  meta,
  trailing,
  href,
  onClick,
  className,
}: ListRowProps) {
  const interactive = href !== undefined || onClick !== undefined;
  const content = (
    <>
      {leading ?? (icon && <IconTile icon={icon} tone={tone} />)}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-ink">{title}</span>
        {subtitle && <span className="block truncate text-xs text-dim">{subtitle}</span>}
      </span>
      {trailing ?? (
        <span className="flex shrink-0 flex-col items-end gap-0.5 text-right">
          {value !== undefined && (
            <span className={cx('text-sm font-bold tabular', VALUE_TONES[valueTone])}>{value}</span>
          )}
          {meta && <span className="text-xs text-dim">{meta}</span>}
        </span>
      )}
    </>
  );
  const classes = cx(
    'flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left',
    interactive &&
      'cursor-pointer transition-colors duration-100 hover:bg-surface-2 focus-visible:bg-surface-2',
    className,
  );
  if (href !== undefined) {
    return (
      <li>
        <Link to={href} className={classes}>
          {content}
        </Link>
      </li>
    );
  }
  if (onClick) {
    return (
      <li>
        <button type="button" onClick={onClick} className={classes}>
          {content}
        </button>
      </li>
    );
  }
  return <li className={classes}>{content}</li>;
}
