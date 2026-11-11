import type { TaskAction } from '@mwc/shared/enums';
import { TASK_REASON_MAX } from '@mwc/shared/flows';
import {
  ArrowRight,
  Check,
  CornerUpLeft,
  type LucideIcon,
  Play,
  RefreshCw,
  Route,
  Stamp,
} from 'lucide-react';
import { useState } from 'react';
import { friendlyMessage, isApiError } from '../../../api/errors.ts';
import type { Flow, FlowCalls, TaskDetail, TaskMove } from '../../../api/flows.ts';
import { ConfirmInline } from '../../../components/forms/ConfirmInline.tsx';
import { Select, Textarea } from '../../../components/forms/Input.tsx';
import { Button, type ButtonTone } from '../../../components/ui/Button.tsx';
import { ForceMove, TurnEnded } from './ForceMove.tsx';

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

/** Send back's reason (required), or Route's step: the panel under the buttons. */
function MovePanel({
  kind,
  task,
  flow,
  busy,
  onSend,
  onClose,
}: {
  readonly kind: 'send_back' | 'route';
  readonly task: TaskDetail;
  readonly flow: Flow | null | undefined;
  readonly busy: boolean;
  readonly onSend: (move: Omit<TaskMove, 'fromStepId'>) => void;
  readonly onClose: () => void;
}) {
  const steps = (flow?.steps ?? []).filter((step) => !(task.state === 'active' && step.id === task.step?.id));
  const [reason, setReason] = useState('');
  const [to, setTo] = useState(steps[0]?.id ?? '');
  const target = flow?.steps.find((step) => step.id === task.step?.id)?.sendsBackTo ?? undefined;
  const why = reason.trim();
  const send = () =>
    onSend({ action: kind, ...(kind === 'route' ? { toStepId: to } : {}), ...(why ? { reason: why } : {}) });
  return (
    <div className="flex flex-col gap-2 rounded-xl bg-surface-2 p-3">
      {kind === 'route' && (
        <Select
          size="sm"
          aria-label="Step"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          options={steps.map((s) => ({ value: s.id, label: `${s.position}. ${s.name}` }))}
        />
      )}
      <Textarea
        aria-label={kind === 'send_back' ? `Why it goes back to ${target ?? 'its step'}` : 'Why (optional)'}
        placeholder={kind === 'send_back' ? `What ${target ?? 'the step'} should fix` : 'Why (optional)'}
        rows={3}
        maxLength={TASK_REASON_MAX}
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        className="min-h-20 text-sm"
      />
      <div className="flex justify-end gap-2">
        <Button size="sm" tone="quiet" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button
          size="sm"
          tone="primary"
          icon={kind === 'route' ? Route : CornerUpLeft}
          busy={busy}
          disabled={kind === 'route' ? to === '' : why === ''}
          onClick={send}
        >
          {kind === 'route' ? 'Move' : `Send back${target ? ` to ${target}` : ''}`}
        </Button>
      </div>
    </div>
  );
}

type Panel = 'send_back' | 'route';

type Sent = Omit<TaskMove, 'fromStepId'>;

/**
 * A move being sent: which one is busy, the open panel, the refusal, the move refused while the step's turn runs
 * (`stuck`, offered again with force), and the send (with the step it was seen at).
 */
function useTaskMove(task: TaskDetail, calls: FlowCalls, onMoved: () => void) {
  const [busy, setBusy] = useState<TaskAction>();
  const [panel, setPanel] = useState<Panel>();
  const [error, setError] = useState<string>();
  const [stuck, setStuck] = useState<Sent>();
  const refused = (move: Sent, failure: unknown) => {
    if (isApiError(failure, 'step_running')) setStuck(move);
    else setError(friendlyMessage(failure));
  };
  const act = async (move: Sent) => {
    setBusy(move.action);
    setError(undefined);
    setStuck(undefined);
    try {
      await calls.act(task.key, { ...move, fromStepId: task.step?.id ?? null });
      setPanel(undefined);
      onMoved();
    } catch (failure) {
      refused(move, failure);
    } finally {
      setBusy(undefined);
    }
  };
  /** Cancel, asked first in place: a refusal while the turn runs offers the forced move too. */
  const cancel = () =>
    calls
      .act(task.key, { action: 'cancel', fromStepId: task.step?.id ?? null })
      .then(onMoved)
      .catch((failure: unknown) => {
        if (!isApiError(failure, 'step_running')) throw failure;
        setStuck({ action: 'cancel' });
      });
  const toggle = (next: Panel) => setPanel((open) => (open === next ? undefined : next));
  return { busy, panel, setPanel, error, act, cancel, toggle, stuck, setStuck };
}

type Move = ReturnType<typeof useTaskMove>;

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

/** The row of buttons: the one-press moves, Send back…, Route to step… and Cancel (asked first). */
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
      {has('cancel') && (
        <div className="ml-auto">
          <ConfirmInline
            label="Cancel task"
            question={`Cancel ${task.key}? It leaves the board.`}
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
 * Approve, with where it goes), Send back (a reason is required), Route to a step, Retry, and Cancel (asked first).
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
      {move.panel && (
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
