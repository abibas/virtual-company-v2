import type { TaskAction } from '@mwc/shared/enums';
import { TASK_REASON_MAX } from '@mwc/shared/flows';
import { CornerUpLeft, Route } from 'lucide-react';
import { useState } from 'react';
import { friendlyMessage, isApiError } from '../../../api/errors.ts';
import type { Flow, FlowCalls, TaskDetail, TaskMove } from '../../../api/flows.ts';
import { Select, Textarea } from '../../../components/forms/Input.tsx';
import { Button } from '../../../components/ui/Button.tsx';

/**
 * The task page's moves that take more than a press (split from `TaskActions.tsx`, T-17): Send back's and Route's
 * panel, and the move being sent with its open panel, refusal and forced retry.
 */

/** Send back's reason (required), or Route's step: the panel under the buttons. */
export function MovePanel({
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

export type Panel = 'send_back' | 'route' | 'reopen';

type Sent = Omit<TaskMove, 'fromStepId'>;

/**
 * A move being sent: which one is busy, the open panel, the refusal, the move refused while the step's turn runs
 * (`stuck`, offered again with force), and the send (with the step it was seen at).
 */
export function useTaskMove(task: TaskDetail, calls: FlowCalls, onMoved: () => void) {
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

export type Move = ReturnType<typeof useTaskMove>;
