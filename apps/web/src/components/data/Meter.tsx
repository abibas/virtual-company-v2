import { cx } from '../cx.ts';

/** A meter's fill: the brand colour, amber for a warning, red for a limit reached, grey for an old reading. */
export type MeterTone = 'blue' | 'input' | 'failed' | 'pending';

const FILLS: Readonly<Record<MeterTone, string>> = {
  blue: 'bg-blue',
  input: 'bg-input',
  failed: 'bg-failed',
  pending: 'bg-faint',
};

/**
 * How much of something is used, as a bar (a subscription's 5-hour window): a quiet track and a rounded fill in the
 * tone of its meaning. Screen readers read it as a meter, with its label and its value in words.
 */
export function Meter({
  value,
  label,
  valueText,
  tone = 'blue',
  size = 'md',
  className,
}: {
  /** 0 to 100. */
  readonly value: number;
  /** What it measures ("5-hour limit"). */
  readonly label: string;
  /** The value in words ("18%, resets in 1h 56m"); the percentage by default. */
  readonly valueText?: string;
  readonly tone?: MeterTone;
  readonly size?: 'sm' | 'md';
  readonly className?: string;
}) {
  const percent = Math.min(100, Math.max(0, value));
  return (
    // biome-ignore lint/a11y/useSemanticElements: the native <meter> cannot be styled alike in every browser; this one is read the same.
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(percent)}
      aria-valuetext={valueText}
      className={cx(
        'w-full overflow-hidden rounded-full bg-surface-3',
        size === 'sm' ? 'h-1.5' : 'h-2',
        className,
      )}
    >
      <div
        className={cx(
          'h-full rounded-full transition-[width] duration-500 motion-reduce:transition-none',
          FILLS[tone],
        )}
        style={{ width: `${percent}%`, minWidth: percent > 0 ? '0.375rem' : 0 }}
      />
    </div>
  );
}
