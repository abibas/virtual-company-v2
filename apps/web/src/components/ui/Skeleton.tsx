import { cx } from '../cx.ts';

/**
 * A placeholder block the shape of what is loading; it pulses unless reduced motion is asked for. `inverse` sits on
 * the gradient cards.
 */
export function Skeleton({
  inverse = false,
  className,
}: {
  readonly inverse?: boolean;
  readonly className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        'block rounded-md motion-safe:animate-pulse',
        inverse ? 'bg-white/20' : 'bg-surface-3',
        className,
      )}
    />
  );
}

/** A few lines of text loading, the last one shorter. */
export function SkeletonText({
  lines = 3,
  className,
}: {
  readonly lines?: number;
  readonly className?: string;
}) {
  return (
    <span aria-hidden="true" className={cx('flex flex-col gap-2', className)}>
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton
          // biome-ignore lint/suspicious/noArrayIndexKey: the lines are identical placeholders.
          key={index}
          className={cx('h-3', index === lines - 1 ? 'w-2/3' : 'w-full')}
        />
      ))}
    </span>
  );
}

/** A list row loading: the tile, two lines, a value. */
export function SkeletonRow() {
  return (
    <span aria-hidden="true" className="flex items-center gap-3 py-2.5">
      <Skeleton className="size-10 rounded-lg" />
      <span className="flex min-w-0 flex-1 flex-col gap-2">
        <Skeleton className="h-3 w-1/2" />
        <Skeleton className="h-2.5 w-3/4" />
      </span>
      <Skeleton className="h-3 w-12" />
    </span>
  );
}

/** A table or list loading: a few rows the shape of its records. */
export function SkeletonRows({ rows = 3 }: { readonly rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }, (_, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: the rows are identical placeholders.
        <SkeletonRow key={index} />
      ))}
    </>
  );
}
