import { cx } from '../cx.ts';
import { Meter, type MeterTone } from './Meter.tsx';

/**
 * The columns every meter row shares, so the percentages line up in one column within a card and across the cards
 * of a grid: a fixed label track, the bar, and a fixed right-aligned track for the reading. On a phone the label
 * takes its own line and the bar and its reading share the next, the reading still right beside its bar.
 */
const COLUMNS = 'grid-cols-[minmax(0,1fr)_3.75rem] sm:grid-cols-[5.25rem_minmax(0,1fr)_3.75rem]';

/** How prominent the reading is: a window's own row, or the smaller rows of its parts (per model). */
export type MeterRowSize = 'sm' | 'md';

export interface MeterRowProps {
  /** The window ("5-hour", "Weekly", "Fable"). */
  readonly label: string;
  /** 0 to 100. */
  readonly value: number;
  /** The reading in the percentage column ("31%", "100%", "—" while unknown). Bold, tabular, always in its column. */
  readonly reading: string;
  /** The dim line under the bar ("resets in 1h 56m", "Limit reached · resets …", "updating…"); none for no line. */
  readonly detail?: string | undefined;
  readonly tone?: MeterTone;
  readonly size?: MeterRowSize;
  /** An old reading (stale, or being checked again): the words greyed and the bar dimmed. */
  readonly muted?: boolean;
  /** What screen readers call the meter ("5-hour limit"); the label by default. */
  readonly meterLabel?: string;
  /** The value in words for screen readers ("18%, resets in 1h 56m"); the reading by default. */
  readonly valueText?: string;
}

/**
 * One row of a limits card: the label, the bar, and the reading in a fixed column, so every percentage is found in
 * the same place. The reset time, or the state of the reading, sits dimmed under the bar.
 */
export function MeterRow({
  label,
  value,
  reading,
  detail,
  tone = 'blue',
  size = 'md',
  muted = false,
  meterLabel = label,
  valueText,
}: MeterRowProps) {
  const md = size === 'md';
  const reached = !muted && tone === 'failed';
  return (
    <div className={cx('grid items-center gap-x-3', COLUMNS, md ? 'gap-y-0.5' : 'gap-y-px')}>
      <span
        className={cx(
          'col-span-2 truncate sm:col-span-1',
          md ? 'text-sm font-semibold' : 'text-xs font-medium',
          muted ? 'text-faint' : md ? 'text-ink' : 'text-dim',
        )}
      >
        {label}
      </span>
      <Meter
        value={value}
        tone={tone}
        size={size}
        label={meterLabel}
        valueText={valueText ?? [reading, detail].filter(Boolean).join(', ')}
        className={cx(muted && 'opacity-50')}
      />
      <span
        className={cx(
          'text-right tabular',
          md ? 'text-sm font-bold' : 'text-xs font-semibold',
          muted ? 'text-faint' : reached ? 'text-failed' : 'text-ink',
        )}
      >
        {reading}
      </span>
      {detail && (
        <span
          className={cx(
            'col-span-2 col-start-1 truncate sm:col-start-2',
            md ? 'text-xs' : 'text-2xs',
            muted ? 'text-faint' : reached ? 'font-medium text-failed' : 'text-dim',
          )}
        >
          {detail}
        </span>
      )}
    </div>
  );
}
