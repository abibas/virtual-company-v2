import { cx } from '../cx.ts';

/**
 * A count in a red dot at a corner (the bell's, the right rail strip's), hidden at 0. `pulse` adds a soft halo that
 * blinks around it while something waits; it plays only when the person has not asked for reduced motion.
 */
export function CountDot({
  count,
  pulse = false,
  className,
}: {
  readonly count: number;
  readonly pulse?: boolean;
  readonly className?: string;
}) {
  if (count <= 0) return null;
  return (
    <span
      className={cx(
        'absolute -top-1 -right-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-failed px-1 text-2xs font-bold text-white ring-2 ring-surface tabular',
        className,
      )}
    >
      {pulse && (
        <span
          aria-hidden="true"
          className="absolute inset-0 rounded-full bg-failed opacity-0 motion-safe:animate-attention"
        />
      )}
      <span className="relative">{count > 99 ? '99+' : count}</span>
    </span>
  );
}
