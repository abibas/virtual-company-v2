import { type ReactNode, useState } from 'react';
import type { MachineStats } from '../../api/types.ts';
import { cx } from '../../components/cx.ts';
import { formatTime, formatWeekdayTime } from '../../components/data/format.ts';
import { Sparkline } from '../../components/data/Sparkline.tsx';
import { UpDownBar } from '../../components/data/UpDownBar.tsx';
import { SegmentedControl } from '../../components/forms/Segmented.tsx';
import { CPU_LIMIT, diskText, hoursText, LOAD_LIMIT, loadText, percentText } from './machine-text.ts';

/** One number of the stats row: its small label, then the value, red when it is over its limit. */
function Metric({
  label,
  alert = false,
  aside,
  className,
  children,
}: {
  readonly label: string;
  readonly alert?: boolean;
  /** A control on the label's line (the up/down period). */
  readonly aside?: ReactNode;
  readonly className?: string | undefined;
  readonly children: ReactNode;
}) {
  return (
    <div className={cx('flex min-w-0 flex-col gap-1', className)}>
      <div className="flex min-h-5 items-center justify-between gap-2">
        <span className="truncate text-2xs font-semibold text-dim">{label}</span>
        {aside}
      </div>
      <div className={cx('text-sm font-bold tabular', alert ? 'text-failed' : 'text-ink')}>{children}</div>
    </div>
  );
}

const PERIODS = [
  { value: 'h24', label: '24 h' },
  { value: 'd7', label: '7 d' },
] as const;

/** Up and down over 24 hours or 7 days, with the switch between them. */
function UpDownMetric({ stats, className }: { readonly stats: MachineStats; readonly className?: string }) {
  const [period, setPeriod] = useState<'h24' | 'd7'>('h24');
  const label = period === 'h24' ? '24 hours' : '7 days';
  return (
    <Metric
      label="Up / down"
      className={className}
      aside={
        <SegmentedControl
          size="sm"
          label="Up and down period"
          options={PERIODS}
          value={period}
          onChange={setPeriod}
          className="-my-1 scale-90 origin-right"
        />
      }
    >
      <UpDownBar
        segments={stats.upDown[period]}
        label={`${stats.name} up and down over ${label}`}
        timeText={period === 'h24' ? formatTime : formatWeekdayTime}
        className="mt-1"
      />
    </Metric>
  );
}

/** The load sparkline over 24 hours, with the dashed line at 1.0 and the time and value under the pointer. */
function LoadMetric({ stats, className }: { readonly stats: MachineStats; readonly className?: string }) {
  const { series } = stats;
  const now = stats.now ? `, now ${loadText(stats.now.loadPerCpu)}` : '';
  return (
    <Metric label="Load / CPU 24 h" className={className}>
      <Sparkline
        points={series.map((point) => point.loadPerCpu)}
        threshold={LOAD_LIMIT}
        label={`${stats.name} load per CPU over 24 hours${now}`}
        pointText={(index) => {
          const point = series[index];
          if (!point) return '';
          return `${formatTime(point.at)} · ${point.loadPerCpu === null ? 'no reading' : loadText(point.loadPerCpu)}`;
        }}
        className="h-8"
      />
    </Metric>
  );
}

/**
 * The stats row of a machine: Load/CPU, CPU, memory, disk, runtime, agent runs, the load sparkline, up/down and the
 * overloaded share. A compact grid in a narrow card, one line of numbers from a wide one (container queries).
 */
export function MachineMetrics({ stats }: { readonly stats: MachineStats }) {
  const { now, runtime, overloaded } = stats;
  const dash = '—';
  return (
    <div className="@container">
      <div className="grid grid-cols-2 gap-x-5 gap-y-3 @md:grid-cols-3 @3xl:grid-cols-6">
        <Metric label="Load / CPU" alert={now !== null && now.loadPerCpu > LOAD_LIMIT}>
          {now ? loadText(now.loadPerCpu) : dash}
        </Metric>
        <Metric label="CPU" alert={now !== null && now.cpuPct > CPU_LIMIT}>
          {now ? percentText(now.cpuPct) : dash}
        </Metric>
        <Metric label="Memory">{now ? percentText(now.memPct) : dash}</Metric>
        <Metric label="Disk">
          {now ? percentText((now.diskUsed / Math.max(now.diskTotal, 1)) * 100) : dash}
          {now && (
            <span className="ml-1.5 text-2xs font-medium text-dim">
              {diskText(now.diskUsed, now.diskTotal)}
            </span>
          )}
        </Metric>
        <Metric label="Runtime 24 h / 7 d">
          {hoursText(runtime.h24Ms)} <span className="font-medium text-dim">/ {hoursText(runtime.d7Ms)}</span>
        </Metric>
        <Metric label="Agent runs 24 h">
          {stats.agentRuns24hMs === null ? dash : hoursText(stats.agentRuns24hMs)}
        </Metric>
        <LoadMetric stats={stats} className="col-span-2 @md:col-span-3 @3xl:col-span-3" />
        <UpDownMetric stats={stats} className="col-span-2 @md:col-span-2" />
        <Metric label="Overloaded 24 h" alert={overloaded.share24h > 0.5}>
          {percentText(overloaded.share24h * 100)}
        </Metric>
      </div>
    </div>
  );
}
