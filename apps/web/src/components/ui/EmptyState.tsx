import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cx } from '../cx.ts';
import type { Tone } from './Badge.tsx';
import { IconTile } from './IconTile.tsx';

/** Nothing here yet, said as an invitation: a tile, a title, one line of what to do, and the way to do it. */
export function EmptyState({
  icon,
  tone = 'neutral',
  title,
  action,
  faces,
  size = 'md',
  className,
  children,
}: {
  readonly icon: LucideIcon;
  readonly tone?: Tone;
  readonly title: string;
  /** A button or a link. */
  readonly action?: ReactNode;
  /** Something to show instead of the tile (a stack of faces). */
  readonly faces?: ReactNode;
  readonly size?: 'sm' | 'md';
  readonly className?: string;
  readonly children?: ReactNode;
}) {
  const inverse = tone === 'inverse';
  return (
    <div
      className={cx(
        'flex flex-col items-center text-center',
        size === 'sm' ? 'gap-2 px-4 py-6' : 'gap-3 px-6 py-10',
        className,
      )}
    >
      {faces ?? <IconTile icon={icon} tone={tone} size={size === 'sm' ? 'md' : 'xl'} />}
      <div className="max-w-xs">
        <p
          className={cx(
            'font-bold',
            size === 'sm' ? 'text-sm' : 'text-md',
            inverse ? 'text-white' : 'text-ink',
          )}
        >
          {title}
        </p>
        {children && <p className={cx('mt-1 text-sm', inverse ? 'text-white/80' : 'text-dim')}>{children}</p>}
      </div>
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
