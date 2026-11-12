import { cx } from '../../components/cx.ts';
import { AgentIcon } from '../../components/feed/AgentIcon.tsx';
import { Tooltip, type TooltipSide } from '../../components/ui/Tooltip.tsx';
import { type RailReport, type ReportDot, reportLabel } from './standing.ts';

const DOTS: Readonly<Record<Exclude<ReportDot, null>, string>> = {
  question: 'bg-input',
  working: 'bg-done',
  unseen: 'bg-blue',
};

/** The small dot at an agent's icon's corner: amber, green pulsing while it works, or blue; nothing without a state. */
export function StateDot({ dot, className }: { readonly dot: ReportDot; readonly className?: string }) {
  if (dot === null) return null;
  const tone = DOTS[dot];
  return (
    <span
      aria-hidden="true"
      className={cx('absolute flex size-2.5 rounded-full ring-2 ring-surface', className)}
    >
      {dot === 'working' && (
        <span className={cx('absolute inset-0 rounded-full opacity-0 motion-safe:animate-attention', tone)} />
      )}
      <span className={cx('relative size-full rounded-full', tone)} />
    </span>
  );
}

/**
 * A direct report as a round button: its icon with its dot, the name and role (and the dot's words) as its label and,
 * with `tooltip`, as a tooltip on that side. `selected` rings it (the open chat).
 */
export function ReportFace({
  report,
  size = 'sm',
  selected = false,
  tooltip,
  onPick,
}: {
  readonly report: RailReport;
  readonly size?: 'xs' | 'sm';
  readonly selected?: boolean;
  readonly tooltip?: TooltipSide;
  readonly onPick: () => void;
}) {
  const label = reportLabel(report);
  const button = (
    <button
      type="button"
      aria-label={`Chat with ${label}`}
      aria-pressed={selected}
      title={tooltip ? undefined : label}
      onClick={onPick}
      className="relative inline-flex shrink-0 cursor-pointer rounded-full outline-offset-2 transition-transform duration-150 hover:scale-105 motion-reduce:transition-none"
    >
      <AgentIcon agent={report.face} size={size} selected={selected} />
      <StateDot
        dot={report.dot}
        className={size === 'xs' ? '-top-0.5 -right-0.5 size-2' : '-top-0.5 -right-0.5'}
      />
    </button>
  );
  if (!tooltip) return button;
  return (
    <Tooltip label={label} side={tooltip}>
      {button}
    </Tooltip>
  );
}
