import type { TaskAction } from '@mwc/shared/enums';
import {
  ArrowRight,
  Check,
  CornerUpLeft,
  type LucideIcon,
  Play,
  RefreshCw,
  RotateCcw,
  Route,
  Stamp,
} from 'lucide-react';
import type { Flow, FlowCalls, TaskDetail } from '../../../api/flows.ts';
import { ConfirmInline } from '../../../components/forms/ConfirmInline.tsx';
import { Button, type ButtonTone } from '../../../components/ui/Button.tsx';
import { ForceMove, TurnEnded } from './ForceMove.tsx';
import { type Move, MovePanel, useTaskMove } from './MovePanel.tsx';
import { ReopenPanel } from './ReopenPanel.tsx';

/** The buttons of the moves that need nothing more than a press. */
const PLAIN: Readonly<Partial<Record<TaskAction, { label: string; icon: LucideIcon; tone: ButtonTone }>>> = {
  start: { label: 'Start', icon: Play, tone: 'secondary' },
  hand_on: { label: 'Hand on', icon: ArrowRight, tone: 'primary' },
  pass: { label: 'Pass', icon: Check, tone: 'primary' },
  approve: { label: 'Approve', icon: Stamp, tone: 'primary' },
  retry: { label: 'Retry', icon: RefreshCw, tone: 'primary' },
};

/** Where a forward move or a retry takes the task, as a few words after its button's label. */
function whereTo(action: TaskAction, task: TaskDetail, flow: Flow | null | undefined): string | undefined {
  if (action === 'retry') return task.escalation?.retryTo?.name;
  if (action !== 'hand_on' && action !== 'pass' && action !== 'approve') return undefined;
  const steps = flow?.steps ?? [];
  const at = steps.findIndex((step) => step.id === task.step?.id);
  if (at < 0) return undefined;
  return steps[at + 1]?.name ?? 'Done';
}

/** The moves that are one press: Start, Hand on, Pass, Approve (with where they go) and Retry. */
function PlainButtons({
  task,
  flow,
  move,
}: {
  readonly task: TaskDetail;
  readonly flow: Flow | null | undefined;
  readonly move: Move;
}) {
  return task.actions.map((action) => {
    const plain = PLAIN[action];
    if (!plain) return null;
    const to = whereTo(action, task, flow);
    return (
      <Button
        key={action}
        size="sm"
        tone={plain.tone}
        icon={plain.icon}
        busy={move.busy === action}
        disabled={move.busy !== undefined}
        onClick={() => void move.act({ action })}
      >
        {plain.label}
        {to && <span className="font-medium opacity-75">→ {to}</span>}
      </Button>
    );
  });
}

/** The row of buttons: the one-press moves, Send back…, Route to step…, Reopen… (T-28) and Cancel (asked first). */
function MoveButtons({
  task,
  flow,
  move,
}: {
  readonly task: TaskDetail;
  readonly flow: Flow | null | undefined;
  readonly move: Move;
}) {
  const has = (action: TaskAction) => task.actions.includes(action);
  const idle = move.busy === undefined;
  return (
    <div className="flex flex-wrap items-start gap-2">
      <PlainButtons task={task} flow={flow} move={move} />
      {has('send_back') && (
        <Button size="sm" icon={CornerUpLeft} disabled={!idle} onClick={() => move.toggle('send_back')}>
          Send back…
        </Button>
      )}
      {has('route') && (
        <Button size="sm" tone="quiet" icon={Route} disabled={!idle} onClick={() => move.toggle('route')}>
          Route to step…
        </Button>
      )}
      {has('reopen') && (
        <Button
          size="sm"
          tone="primary"
          icon={RotateCcw}
          disabled={!idle}
          onClick={() => move.toggle('reopen')}
        >
          Reopen…
        </Button>
      )}
      {has('cancel') && (
        <div className="ml-auto">
          <ConfirmInline
            label="Cancel task"
            question={`Cancel ${task.key}?`}
            confirmLabel="Cancel task"
            onConfirm={move.cancel}
          />
        </div>
      )}
    </div>
  );
}

/**
 * The moves the caller may make on the task now (the API's `actions`): Start, the step's outcome (Hand on, Pass or
 * Approve, with where it goes), Send back (a reason is required), Route to a step, Retry, Reopen a done or cancelled
 * task with a correction (T-28), and Cancel (asked first).
 * Each is sent with the step the page shows the task at, so a task that moved meanwhile is refused, not moved twice.
 * A move refused while the step's turn runs offers "Stop the turn and move" (S5.3b); a turn that ended without a
 * hand-off says what to do next.
 */
export function TaskActions({
  task,
  flow,
  calls,
  onMoved,
}: {
  readonly task: TaskDetail;
  readonly flow: Flow | null | undefined;
  readonly calls: FlowCalls;
  readonly onMoved: () => void;
}) {
  const move = useTaskMove(task, calls, onMoved);
  return (
    <div className="flex flex-col gap-2">
      <MoveButtons task={task} flow={flow} move={move} />
      {move.panel === 'reopen' && (
        <ReopenPanel
          task={task}
          flow={flow}
          busy={move.busy !== undefined}
          onSend={(next) => void move.act(next)}
          onClose={() => move.setPanel(undefined)}
        />
      )}
      {move.panel && move.panel !== 'reopen' && (
        <MovePanel
          key={move.panel}
          kind={move.panel}
          task={task}
          flow={flow}
          busy={move.busy !== undefined}
          onSend={(next) => void move.act(next)}
          onClose={() => move.setPanel(undefined)}
        />
      )}
      {move.stuck && (
        <ForceMove
          task={task}
          move={move.stuck}
          calls={calls}
          onMoved={onMoved}
          onDismiss={() => move.setStuck(undefined)}
        />
      )}
      {move.error && (
        <p role="alert" className="text-sm font-medium text-failed">
          {move.error}
        </p>
      )}
      <TurnEnded task={task} />
    </div>
  );
}
