import { TriangleAlert } from 'lucide-react';
import type { SubscriptionLimits } from '../../api/types.ts';
import { MeterRow, type MeterRowSize } from '../data/MeterRow.tsx';
import {
  detailText,
  mainWindows,
  meterTone,
  modelWindows,
  type NamedWindow,
  readingText,
  resetPassed,
} from './limits.ts';

interface RowProps extends NamedWindow {
  readonly stale: boolean;
  readonly now: number;
  readonly size: MeterRowSize;
}

/**
 * A window as one aligned row: its name, the bar, its share in the percentage column, and under the bar when it
 * resets ("Limit reached · resets …" in red, "updating…" over a dimmed bar once its reset has passed). The 5-hour
 * and weekly windows are full rows; the per-model ones the same, a little smaller.
 */
function WindowRow({ name, window, stale, now, size }: RowProps) {
  return (
    <MeterRow
      label={name}
      size={size}
      value={window.usedPercent}
      tone={meterTone(window, stale, now)}
      reading={readingText(window, now)}
      detail={detailText(window, now)}
      muted={stale || resetPassed(window, now)}
      meterLabel={`${name} limit`}
    />
  );
}

/** The last check's refusal in plain words, and that the bars are its last good values. */
function CheckProblem({ limits }: { readonly limits: SubscriptionLimits }) {
  if (!limits.error) return null;
  return (
    <p className="flex items-start gap-2 rounded-lg bg-input-soft px-3 py-2 text-xs font-medium text-ink">
      <TriangleAlert size={14} strokeWidth={2.25} aria-hidden="true" className="mt-px shrink-0 text-input" />
      <span>
        {limits.error.message}
        {limits.stale && limits.windows.length > 0 && (
          <span className="text-dim"> The bars show the last values that came through.</span>
        )}
      </span>
    </p>
  );
}

/**
 * One subscription's limits, as the home widget and the Subscriptions page show them: the 5-hour and weekly bars,
 * the per-model weekly ones when there are any, and the last check's refusal with the old values greyed.
 */
export function LimitMeters({ limits, now }: { readonly limits: SubscriptionLimits; readonly now: number }) {
  const main = mainWindows(limits);
  const models = modelWindows(limits);
  const stale = limits.stale;
  return (
    <div className="flex flex-col gap-3">
      <CheckProblem limits={limits} />
      {main.map((row) => (
        <WindowRow key={row.window.id} {...row} stale={stale} now={now} size="md" />
      ))}
      {models.length > 0 && (
        <div className="flex flex-col gap-2 border-t border-line pt-3">
          {models.map((row) => (
            <WindowRow key={row.window.id} {...row} stale={stale} now={now} size="sm" />
          ))}
        </div>
      )}
      {main.length === 0 && models.length === 0 && !limits.error && (
        <p className="text-sm text-dim">
          {limits.checkedAt
            ? 'The provider gave no limits for it.'
            : 'Its limits are checked when the page opens.'}
        </p>
      )}
    </div>
  );
}
