import { cx } from '../cx.ts';
import type { Tone } from './Badge.tsx';
import type { IconComponent } from './icon.ts';

const TONES: Readonly<Record<Tone, string>> = {
  neutral: 'bg-surface-3 text-ink-2',
  blue: 'bg-blue-soft text-blue',
  teal: 'bg-teal-soft text-teal',
  input: 'bg-input-soft text-input',
  blocked: 'bg-blocked-soft text-blocked',
  review: 'bg-review-soft text-review',
  failed: 'bg-failed-soft text-failed',
  done: 'bg-done-soft text-done',
  pending: 'bg-pending-soft text-pending',
  inverse: 'bg-white/18 text-white',
};

const SIZES = {
  sm: { box: 'size-8 rounded-md', icon: 15 },
  md: { box: 'size-10 rounded-lg', icon: 18 },
  lg: { box: 'size-12 rounded-xl', icon: 22 },
  xl: { box: 'size-14 rounded-xl', icon: 26 },
} as const;

/** A rounded, tinted square with an icon: the mark of a feed row, an empty state, a stat. */
export function IconTile({
  icon: Icon,
  tone = 'neutral',
  size = 'md',
  className,
}: {
  readonly icon: IconComponent;
  readonly tone?: Tone;
  readonly size?: keyof typeof SIZES;
  readonly className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        'inline-flex shrink-0 items-center justify-center',
        SIZES[size].box,
        TONES[tone],
        className,
      )}
    >
      <Icon size={SIZES[size].icon} strokeWidth={2} />
    </span>
  );
}
