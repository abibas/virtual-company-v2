import { TriangleAlert } from 'lucide-react';
import type { SubscriptionLimits } from '../../api/types.ts';
import { cx } from '../cx.ts';
import { Meter } from '../data/Meter.tsx';
import {
  mainWindows,
  meterTone,
  modelWindows,
  type NamedWindow,
  percentText,
  resetPassed,
  UPDATING,
  windowLine,
} from './limits.ts';

interface RowProps extends NamedWindow {
  readonly stale: boolean;
  readonly now: number;
}

/**
 * A 5-hour or weekly window: its name and reading on a line ("18% · resets in 1h 56m"), the bar under it; once its
 * reset has passed, "updating…" over a dimmed bar until the next check.
 */
function WindowRow({ name, window, stale, now }: RowProps) {
  const line = windowLine(window, now);
  const updating = resetPassed(window, now);
  const old = stale || updating;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className={cx('shrink-0 font-semibold', old ? 'text-dim' : 'text-ink')}>{name}</span>
        <span
          className={cx(
            'min-w-0 truncate text-right tabular',
            old ? 'text-faint' : window.reached ? 'font-semibold text-failed' : 'text-ink-2',
          )}
        >
          {line}
        </span>
      </div>
      <Meter
        value={window.usedPercent}
        tone={meterTone(window, stale, now)}
        label={`${name} limit`}
        valueText={line}
        className={cx('mt-1.5', updating && 'opacity-50')}
      />
    </div>
  );
}

/** A per-model window, compact: its name, a thin bar and its share ("updating…" over a dimmed bar after its reset). */
function ModelRow({ name, window, stale, now }: RowProps) {
  const updating = resetPassed(window, now);
  const share = updating ? UPDATING : percentText(window.usedPercent);
  return (
    <div className="grid grid-cols-[4.5rem_minmax(0,1fr)_minmax(2.5rem,auto)] items-center gap-3 text-xs">
      <span className="truncate font-medium text-dim">{name}</span>
      <Meter
        size="sm"
        value={window.usedPercent}
        tone={meterTone(window, stale, now)}
        label={`${name} limit`}
        valueText={share}
        className={cx(updating && 'opacity-50')}
      />
      <span className={cx('text-right tabular', stale || updating ? 'text-faint' : 'text-ink-2')}>
        {share}
      </span>
    </div>
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
        <WindowRow key={row.window.id} {...row} stale={stale} now={now} />
      ))}
      {models.length > 0 && (
        <div className="flex flex-col gap-1.5 border-t border-line pt-3">
          {models.map((row) => (
            <ModelRow key={row.window.id} {...row} stale={stale} now={now} />
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
