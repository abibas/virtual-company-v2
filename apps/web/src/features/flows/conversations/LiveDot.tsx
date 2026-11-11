import { cx } from '../../../components/cx.ts';

/**
 * A small coloured dot; `live` adds the soft halo that blinks around it while an agent's turn runs (motion-safe only;
 * the words beside it say the same).
 */
export function LiveDot({
  live,
  className = 'bg-blue',
}: {
  readonly live: boolean;
  /** Its colour (a background class). */
  readonly className?: string;
}) {
  return (
    <span aria-hidden="true" className="relative inline-flex size-1.5 shrink-0">
      {live && (
        <span
          className={cx('absolute inset-0 rounded-full opacity-0 motion-safe:animate-attention', className)}
        />
      )}
      <span className={cx('relative size-1.5 rounded-full', className)} />
    </span>
  );
}
