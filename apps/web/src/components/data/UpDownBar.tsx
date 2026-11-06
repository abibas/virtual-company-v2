import { cx } from '../cx.ts';
import { formatTime } from './format.ts';

export interface UpDownSpan {
  readonly from: string;
  readonly to: string;
  readonly up: boolean;
}

/** The share of the time that was up, 0 to 100. */
export function upShare(segments: readonly UpDownSpan[]): number {
  let up = 0;
  let all = 0;
  for (const segment of segments) {
    const ms = Date.parse(segment.to) - Date.parse(segment.from);
    all += ms;
    if (segment.up) up += ms;
  }
  return all > 0 ? (up / all) * 100 : 0;
}

/**
 * When something was up and when it was down, as one bar across its period (a machine's last 24 hours): green
 * stretches up, grey down, each with its times on hover. Screen readers hear the share that was up.
 */
export function UpDownBar({
  segments,
  label,
  timeText = formatTime,
  className,
}: {
  /** The stretches, oldest first, covering the period. */
  readonly segments: readonly UpDownSpan[];
  /** What it shows ("Up and down over 24 hours"); the share up is added for screen readers. */
  readonly label: string;
  /** A time as the tooltips show it (the time of day by default; a weekday too over 7 days). */
  readonly timeText?: (iso: string) => string;
  readonly className?: string;
}) {
  const start = Date.parse(segments[0]?.from ?? '');
  const end = Date.parse(segments.at(-1)?.to ?? '');
  const span = end - start;
  return (
    <span
      role="img"
      aria-label={`${label}: up ${Math.round(upShare(segments))}% of the time`}
      className={cx('relative block h-2.5 overflow-hidden rounded-full bg-surface-3', className)}
    >
      {span > 0 &&
        segments.map((segment) => {
          const left = ((Date.parse(segment.from) - start) / span) * 100;
          const width = ((Date.parse(segment.to) - Date.parse(segment.from)) / span) * 100;
          return (
            <span
              key={segment.from}
              title={`${segment.up ? 'Up' : 'Down'} ${timeText(segment.from)} – ${timeText(segment.to)}`}
              className={cx('absolute inset-y-0', segment.up ? 'bg-done' : 'bg-faint/40')}
              style={{ left: `${left}%`, width: `max(${width}%, 2px)` }}
            />
          );
        })}
    </span>
  );
}
