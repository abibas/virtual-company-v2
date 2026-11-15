import { TASK_REASON_MAX } from '@mwc/shared/flows';
import { useState } from 'react';
import { friendlyMessage, isApiError } from '../../../api/errors.ts';
import type { FlowCalls, TaskDetail } from '../../../api/flows.ts';
import { Input, Select } from '../../../components/forms/Input.tsx';
import { Badge } from '../../../components/ui/Badge.tsx';
import { Button } from '../../../components/ui/Button.tsx';
import { TASK_STATE } from '../words.ts';
import { ForceMove } from './ForceMove.tsx';

/** The ways to cancel from the Status menu: each sends its reason; "other" asks for one. */
const CANCELS = [
  { value: 'not needed', label: 'Cancel: not needed' },
  { value: 'invalid', label: 'Cancel: invalid' },
  { value: 'duplicate', label: 'Cancel: duplicate' },
  { value: 'other', label: 'Cancel: other…' },
] as const;

/** Why a cancelled task was cancelled: the reason of its latest cancel in the history; undefined for none. */
function cancelReason(task: TaskDetail): string | undefined {
  if (task.state !== 'cancelled') return undefined;
  const event = task.history.findLast((e) => e.kind === 'cancelled');
  return event?.reason ?? undefined;
}

/**
 * Cancelling from the Status row: the reason picked (asked first), the refusal, and the cancel refused while the step's
 * turn runs (`stuck`, offered again with force, as the action bar's Cancel task does).
 */
export function useTaskCancel(task: TaskDetail, calls: FlowCalls, onMoved: () => void) {
  const [picked, setPicked] = useState<string>();
  const [stuck, setStuck] = useState<string>();
  const canCancel = task.actions.includes('cancel');
  const cancel = (reason: string) =>
    calls
      .act(task.key, { action: 'cancel', reason, fromStepId: task.step?.id ?? null })
      .then(() => {
        setPicked(undefined);
        onMoved();
      })
      .catch((failure: unknown) => {
        if (!isApiError(failure, 'step_running')) throw failure;
        setPicked(undefined);
        setStuck(reason);
      });
  return { picked, setPicked, stuck, setStuck, canCancel, cancel };
}

type Cancel = ReturnType<typeof useTaskCancel>;

/** The Status value: the state's badge (a cancelled task's reason beside it) and, for who may cancel, its menu. */
export function StatusValue({ task, cancel }: { readonly task: TaskDetail; readonly cancel: Cancel }) {
  const look = TASK_STATE[task.state];
  const reason = cancelReason(task);
  if (!cancel.canCancel)
    return (
      <span className="flex min-w-0 items-center gap-1.5">
        <Badge tone={look.tone} size="sm">
          {look.label}
        </Badge>
        {reason && (
          <span className="truncate text-xs font-normal text-ink-2" title={reason}>
            {reason}
          </span>
        )}
      </span>
    );
  return (
    <Select
      size="sm"
      aria-label="Status"
      value=""
      className="w-36!"
      onChange={(event) => {
        cancel.setStuck(undefined);
        cancel.setPicked(event.target.value || undefined);
      }}
      options={[{ value: '', label: look.label }, ...CANCELS]}
    />
  );
}

/** The confirmation under the Status row once a cancel is picked: the question, a reason for "other", and the send. */
function CancelPrompt({ task, cancel }: { readonly task: TaskDetail; readonly cancel: Cancel }) {
  const [other, setOther] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const picked = cancel.picked ?? '';
  const asks = picked === 'other';
  const reason = asks ? other.trim() : picked;
  const send = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await cancel.cancel(reason);
    } catch (failure) {
      setError(friendlyMessage(failure));
    } finally {
      setBusy(false);
    }
  };
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: Escape anywhere in the confirmation drops it.
    <div
      className="flex flex-col items-end gap-2 rounded-lg bg-failed-soft p-3 text-right"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !busy) cancel.setPicked(undefined);
      }}
    >
      <p className="text-sm font-medium text-ink">Cancel {task.key}? It leaves the board.</p>
      {asks ? (
        <Input
          size="sm"
          aria-label="Why it is cancelled"
          placeholder="Why, in a few words"
          maxLength={TASK_REASON_MAX}
          value={other}
          onChange={(event) => setOther(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && reason !== '' && !busy) void send();
          }}
          // biome-ignore lint/a11y/noAutofocus: the reason is what the person came to type.
          autoFocus
        />
      ) : (
        <p className="text-xs text-ink-2">Reason: {picked}</p>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <Button size="sm" disabled={busy} onClick={() => cancel.setPicked(undefined)}>
          Keep it
        </Button>
        <Button size="sm" tone="danger" busy={busy} disabled={reason === ''} onClick={() => void send()}>
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

/** What opens under the Status row: the confirmation of a picked cancel, or "Stop the turn and move" when it runs. */
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
        <CancelPrompt key={cancel.picked} task={task} cancel={cancel} />
      </div>
    );
  if (cancel.stuck)
    return (
      <div className="sm:col-span-2 lg:col-span-1">
        <ForceMove
          task={task}
          move={{ action: 'cancel', reason: cancel.stuck }}
          calls={calls}
          onMoved={onMoved}
          onDismiss={() => cancel.setStuck(undefined)}
        />
      </div>
    );
  return null;
}
