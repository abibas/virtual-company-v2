import type { TaskRow } from '../../api/tasks.ts';
import { cx } from '../../components/cx.ts';
import { ago, formatDateTime } from '../../components/data/format.ts';
import { Badge, type Tone } from '../../components/ui/Badge.tsx';
import { LiveDot } from '../flows/conversations/LiveDot.tsx';
import { KIND, PRIORITY, stepStateLook, TASK_STATE } from '../flows/words.ts';

/** Where a task stands, in the board's words: its step state while active, else its state. */
export function rowLook(task: TaskRow, mine: boolean): { label: string; tone: Tone } {
  if (task.state !== 'active' || task.stepState === null) return TASK_STATE[task.state];
  if (task.stepState === 'needs_person' && task.step?.kind === 'signoff') {
    return { label: mine ? 'Needs your sign-off' : 'Waiting for sign-off', tone: 'review' };
  }
  return stepStateLook(task.stepState, mine);
}

/** The state's pill: a pulsing dot while a turn runs, and why it is blocked on hover. */
export function StatePill({ task, mine }: { readonly task: TaskRow; readonly mine: boolean }) {
  const look = rowLook(task, mine);
  const working = task.state === 'active' && task.stepState === 'working';
  const reason = task.stepState === 'blocked' ? (task.blockedReason ?? undefined) : undefined;
  return (
    <span title={reason} className={cx('inline-flex min-w-0', reason && 'cursor-help')}>
      <Badge tone={look.tone} size="sm" dot={!working}>
        {working && <LiveDot live className="bg-blue" />}
        {look.label}
      </Badge>
      {reason && <span className="sr-only">: {reason}</span>}
    </span>
  );
}

/** The step it is at, in its kind's colour as on the board; a dash when it is at none. */
export function StepChip({ step }: { readonly step: TaskRow['step'] }) {
  if (!step) return <span className="text-faint">—</span>;
  const kind = KIND[step.kind];
  return (
    <span
      title={`${kind.label}: ${step.name}`}
      className={cx(
        'inline-flex h-5 max-w-full items-center rounded-full px-2 text-2xs font-semibold',
        kind.soft,
        kind.text,
      )}
    >
      <span className="truncate">{step.name}</span>
    </span>
  );
}

/** Its priority; Normal quietly. */
export function PriorityMark({ priority }: { readonly priority: TaskRow['priority'] }) {
  const look = PRIORITY[priority];
  if (priority === 'normal') return <span className="text-xs text-dim">{look.label}</span>;
  return (
    <Badge tone={look.tone} size="sm">
      {look.label}
    </Badge>
  );
}

/** When it last changed, with the exact time on hover. */
export function Updated({ at }: { readonly at: string }) {
  return (
    <time dateTime={at} title={formatDateTime(at)} className="text-xs whitespace-nowrap text-dim">
      {ago(at)}
    </time>
  );
}
