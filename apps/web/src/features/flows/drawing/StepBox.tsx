import type { FlowStepKind, PrincipalKind, StepOnReturn } from '@mwc/shared/enums';
import { CircleCheck } from 'lucide-react';
import type { ChartNode } from '../../../api/types.ts';
import { cx } from '../../../components/cx.ts';
import { Who } from '../Face.tsx';
import { KIND, RETURN_MARK } from '../words.ts';

/** A step as the drawing shows it, from a flow or from the editor's draft. */
export interface DrawnStep {
  /** Its id, or the draft's key for a step not saved yet. */
  readonly key: string;
  readonly name: string;
  readonly kind: FlowStepKind;
  readonly assignee: { readonly principalId: string; readonly kind: PrincipalKind; readonly name: string };
  readonly onReturn: StepOnReturn;
  /** The key of the step it sends back to. */
  readonly sendsBackTo: string | null;
  readonly sendBackLimit: number | null;
}

/** The box's width: every box the same, so the row reads as a line. */
export const BOX = 'w-44';

/** Keep ↻ or Fresh ✦ (an agent's step: people keep no conversation), and the send-back limit as "3×". */
function Marks({ step }: { readonly step: DrawnStep }) {
  const back = RETURN_MARK[step.onReturn];
  return (
    <span className="flex shrink-0 items-center gap-1">
      {step.assignee.kind === 'agent' && (
        <span
          title={`Comes back again: ${back.label}`}
          className="rounded-full bg-surface-3 px-1.5 text-2xs leading-4 font-semibold text-ink-2"
        >
          {back.mark} {back.label}
        </span>
      )}
      {step.sendBackLimit !== null && (
        <span
          title={`After ${step.sendBackLimit} send-backs the Lead gets it`}
          className={cx(
            'rounded-full px-1.5 text-2xs leading-4 font-bold tabular',
            KIND[step.kind].soft,
            KIND[step.kind].text,
          )}
        >
          {step.sendBackLimit}×
        </span>
      )}
    </span>
  );
}

/**
 * One step of the drawing: a box in its kind's colour (a bar on top, the kind's word), its name, and its assignee's
 * face and name, with its marks; `here` rings it (where a task is), with `note` under it ("round 2").
 */
export function StepBox({
  step,
  nodes,
  here = false,
  note,
}: {
  readonly step: DrawnStep;
  readonly nodes: ReadonlyMap<string, ChartNode>;
  readonly here?: boolean;
  readonly note?: string | undefined;
}) {
  const look = KIND[step.kind];
  return (
    <div
      data-step={step.key}
      className={cx(
        'relative flex shrink-0 flex-col gap-1 overflow-hidden rounded-xl px-3 pt-3 pb-2.5 shadow-card',
        BOX,
        here ? cx('ring-2', look.ring, look.soft) : 'bg-surface ring-1 ring-line',
      )}
    >
      <span aria-hidden="true" className={cx('absolute inset-x-0 top-0 h-[3px]', look.solid)} />
      <span className="flex items-center justify-between gap-1">
        <span className={cx('text-2xs font-bold tracking-wide uppercase', look.text)}>{look.label}</span>
        <Marks step={step} />
      </span>
      <span className="truncate text-sm font-bold text-ink" title={step.name}>
        {step.name}
      </span>
      <Who who={step.assignee} nodes={nodes} className="text-xs text-ink-2" />
      {note && <span className={cx('text-2xs font-semibold', look.text)}>{note}</span>}
    </div>
  );
}

/** The end of the row: Done, ringed when the task is done. */
export function DoneBox({ here = false }: { readonly here?: boolean }) {
  return (
    <div
      data-step="done"
      className={cx(
        'flex shrink-0 items-center gap-1.5 self-center rounded-xl px-3 py-2.5 text-sm font-bold shadow-card',
        here ? 'bg-done-soft text-done ring-2 ring-done' : 'bg-surface text-done ring-1 ring-line',
      )}
    >
      <CircleCheck size={15} strokeWidth={2.5} aria-hidden="true" />
      Done
    </div>
  );
}
