import { ChevronRight } from 'lucide-react';
import { useMemo } from 'react';
import type { Flow } from '../../../api/flows.ts';
import type { ChartNode } from '../../../api/types.ts';
import { cx } from '../../../components/cx.ts';
import { lanesRoom, type SendBack, SendBackArrows } from './SendBackArrows.tsx';
import { DoneBox, type DrawnStep, StepBox } from './StepBox.tsx';

/** A flow's steps as the drawing reads them. */
export const drawnSteps = (flow: Flow): DrawnStep[] =>
  flow.steps.map((step) => ({
    key: step.id,
    name: step.name,
    kind: step.kind,
    assignee: step.assignee,
    onReturn: step.onReturn,
    sendsBackTo: step.sendsBackToStepId,
    sendBackLimit: step.sendBackLimit,
  }));

/** The send-backs to draw: each Check or Sign-off step's, to an earlier step that is drawn. */
function sendBacksOf(steps: readonly DrawnStep[]): SendBack[] {
  const keys = steps.map((step) => step.key);
  return steps.flatMap((step, index) => {
    const target = step.sendsBackTo === null ? -1 : keys.indexOf(step.sendsBackTo);
    return step.kind !== 'work' && target >= 0 && target < index
      ? [{ from: step.key, to: keys[target] ?? '', kind: step.kind }]
      : [];
  });
}

/**
 * A flow drawn as docs/processes.md says: one row of boxes left to right, coloured by kind, each with its assignee's
 * face and name, its Keep or Fresh mark and its limit, then Done; dashed arrows from the Check and Sign-off boxes back
 * to the step they send back to. `here` rings the step a task is at (`done`: the Done box), `notes` puts a line under
 * a box ("round 2"). The row scrolls sideways when it is wider than the page.
 */
export function FlowDrawing({
  steps,
  nodes,
  here,
  notes,
  className,
}: {
  readonly steps: readonly DrawnStep[];
  readonly nodes: ReadonlyMap<string, ChartNode>;
  readonly here?: string | undefined;
  readonly notes?: ReadonlyMap<string, string> | undefined;
  readonly className?: string;
}) {
  const arrows = useMemo(() => sendBacksOf(steps), [steps]);
  const order = useMemo(() => steps.map((step) => step.key), [steps]);
  return (
    <div className={cx('scroll-quiet overflow-x-auto', className)}>
      <div
        className="relative inline-flex min-w-full p-1"
        style={{ paddingBottom: lanesRoom(arrows.length) + 4 }}
      >
        <ol aria-label="Steps" className="flex items-stretch gap-1.5">
          {steps.map((step, index) => (
            <li key={step.key} className="flex items-stretch gap-1.5">
              {index > 0 && <Arrow />}
              <StepBox step={step} nodes={nodes} here={here === step.key} note={notes?.get(step.key)} />
            </li>
          ))}
          <li className="flex items-center gap-1.5">
            {steps.length > 0 && <Arrow />}
            <DoneBox here={here === 'done'} />
          </li>
        </ol>
        <SendBackArrows arrows={arrows} order={order} />
      </div>
    </div>
  );
}

/** The way forward between two boxes. */
function Arrow() {
  return (
    <ChevronRight
      size={16}
      strokeWidth={2.5}
      aria-hidden="true"
      className="shrink-0 self-center text-faint"
    />
  );
}
