import { type LucideIcon, TrendingDown, TrendingUp } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from '../../app/router.tsx';
import { cx } from '../cx.ts';
import { Badge, type Tone } from '../ui/Badge.tsx';
import { Card } from '../ui/Card.tsx';
import { IconTile } from '../ui/IconTile.tsx';
import { Skeleton } from '../ui/Skeleton.tsx';

export interface Delta {
  /** "+3", "12%", "2 this week". */
  readonly value: string;
  readonly direction?: 'up' | 'down' | 'flat';
}

/** A big number with its label, an optional icon, a delta chip, and a line of context. */
export function StatTile({
  label,
  value,
  delta,
  icon,
  tone = 'blue',
  hint,
  href,
  loading = false,
  className,
}: {
  readonly label: string;
  readonly value: ReactNode;
  readonly delta?: Delta;
  readonly icon?: LucideIcon;
  readonly tone?: Tone;
  readonly hint?: ReactNode;
  /** The tile is a link to where the number comes from. */
  readonly href?: string;
  readonly loading?: boolean;
  readonly className?: string;
}) {
  const deltaTone: Tone =
    delta?.direction === 'down' ? 'failed' : delta?.direction === 'flat' ? 'neutral' : 'done';
  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-dim">{label}</p>
        {icon && <IconTile icon={icon} tone={tone} size="sm" />}
      </div>
      <div className="mt-2 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        {loading ? (
          <Skeleton className="h-8 w-16" />
        ) : (
          <p className="text-3xl font-extrabold tracking-[-0.03em] text-ink tabular">{value}</p>
        )}
        {delta && !loading && (
          <Badge
            tone={deltaTone}
            size="sm"
            icon={
              delta.direction === 'down' ? TrendingDown : delta.direction === 'up' ? TrendingUp : undefined
            }
          >
            {delta.value}
          </Badge>
        )}
      </div>
      {hint && <p className="mt-1.5 text-xs text-dim">{hint}</p>}
    </>
  );
  if (href !== undefined) {
    return (
      <Link to={href} className={cx('group/stat block rounded-2xl', className)}>
        <Card padding="sm" interactive className="h-full px-5">
          {body}
        </Card>
      </Link>
    );
  }
  return (
    <Card padding="sm" className={cx('px-5', className)}>
      {body}
    </Card>
  );
}
