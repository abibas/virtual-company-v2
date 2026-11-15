import { useState } from 'react';
import { friendlyMessage, isApiError } from '../../../api/errors.ts';
import type { FlowCalls, TaskDetail } from '../../../api/flows.ts';
import { Select } from '../../../components/forms/Input.tsx';
import { Badge } from '../../../components/ui/Badge.tsx';
import { Button } from '../../../components/ui/Button.tsx';
import { TASK_STATE } from '../words.ts';
import { ForceMove } from './ForceMove.tsx';

/**
 * Cancelling from the Status row: whether Cancel is picked (asked first), and the cancel refused while the step's turn
 * runs (`stuck`, offered again with force, as the action bar's Cancel task does).
 */
export function useTaskCancel(task: TaskDetail, calls: FlowCalls, onMoved: () => void) {
  const [picked, setPicked] = useState(false);
  const [stuck, setStuck] = useState(false);
  const canCancel = task.actions.includes('cancel');
  const cancel = () =>
    calls
      .act(task.key, { action: 'cancel', fromStepId: task.step?.id ?? null })
      .then(() => {
        setPicked(false);
        onMoved();
      })
      .catch((failure: unknown) => {
        if (!isApiError(failure, 'step_running')) throw failure;
        setPicked(false);
        setStuck(true);
      });
  return { picked, setPicked, stuck, setStuck, canCancel, cancel };
}

type Cancel = ReturnType<typeof useTaskCancel>;

/** The Status value: the state's badge (Cancelled in red) and, for who may cancel, a menu with its one Cancel. */
export function StatusValue({ task, cancel }: { readonly task: TaskDetail; readonly cancel: Cancel }) {
  const look = TASK_STATE[task.state];
  if (!cancel.canCancel)
    return (
      <Badge tone={look.tone} size="sm">
        {look.label}
      </Badge>
    );
  return (
    <Select
      size="sm"
      aria-label="Status"
      value=""
      className="w-32!"
      onChange={(event) => {
        cancel.setStuck(false);
        cancel.setPicked(event.target.value === 'cancel');
      }}
      options={[
        { value: '', label: look.label },
        { value: 'cancel', label: 'Cancel' },
      ]}
    />
  );
}

/** The confirmation under the Status row once Cancel is picked. */
function CancelPrompt({ task, cancel }: { readonly task: TaskDetail; readonly cancel: Cancel }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const send = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await cancel.cancel();
    } catch (failure) {
      setError(friendlyMessage(failure));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col items-end gap-2 rounded-lg bg-failed-soft p-3 text-right">
      <p className="text-sm font-medium text-ink">Cancel {task.key}?</p>
      <div className="flex flex-wrap justify-end gap-2">
        <Button size="sm" disabled={busy} onClick={() => cancel.setPicked(false)}>
          Keep it
        </Button>
        <Button size="sm" tone="danger" busy={busy} onClick={() => void send()}>
          Cancel task
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-xs font-medium text-failed">
          {error}
        </p>
      )}
    </div>
  );
}

/** What opens under the Status row: the confirmation of Cancel, or "Stop the turn and move" when a turn runs. */
export function StatusPanel({
  task,
  calls,
  cancel,
  onMoved,
}: {
  readonly task: TaskDetail;
  readonly calls: FlowCalls;
  readonly cancel: Cancel;
  readonly onMoved: () => void;
}) {
  if (cancel.picked)
    return (
      <div className="sm:col-span-2 lg:col-span-1">
        <CancelPrompt task={task} cancel={cancel} />
      </div>
    );
  if (cancel.stuck)
    return (
      <div className="sm:col-span-2 lg:col-span-1">
        <ForceMove
          task={task}
          move={{ action: 'cancel' }}
          calls={calls}
          onMoved={onMoved}
          onDismiss={() => cancel.setStuck(false)}
        />
      </div>
    );
  return null;
}
