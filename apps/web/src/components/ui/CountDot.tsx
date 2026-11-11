import { cx } from '../cx.ts';

/** Red for what needs the person, blue for what is only unread (the notifications). */
export type CountTone = 'alert' | 'info';

const TONES: Readonly<Record<CountTone, string>> = {
  alert: 'bg-failed text-white',
  info: 'bg-blue text-on-blue',
};

/**
 * A count in a dot at a corner (the right rail strip's), hidden at 0: red (`alert`) for what needs the person, blue
 * (`info`) for unread notices. `pulse` adds a soft halo that blinks around it while something waits; it plays only when
 * the person has not asked for reduced motion.
 */
export function CountDot({
  count,
  pulse = false,
  tone = 'alert',
  className,
}: {
  readonly count: number;
  readonly pulse?: boolean;
  readonly tone?: CountTone;
  readonly className?: string;
}) {
  if (count <= 0) return null;
  return (
    <span
      className={cx(
        'absolute -top-1 -right-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-2xs font-bold ring-2 ring-surface tabular',
        TONES[tone],
        className,
      )}
    >
      {pulse && (
        <span
          aria-hidden="true"
          className={cx('absolute inset-0 rounded-full opacity-0 motion-safe:animate-attention', TONES[tone])}
        />
      )}
      <span className="relative">{count > 99 ? '99+' : count}</span>
    </span>
  );
}
