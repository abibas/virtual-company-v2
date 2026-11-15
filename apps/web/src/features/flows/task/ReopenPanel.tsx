import { TASK_REASON_MAX, TOOL_TEXT_MAX } from '@mwc/shared/flows';
import { RotateCcw } from 'lucide-react';
import { useState } from 'react';
import type { Flow, TaskDetail, TaskMove } from '../../../api/flows.ts';
import { Input, Textarea } from '../../../components/forms/Input.tsx';
import { Button } from '../../../components/ui/Button.tsx';

/**
 * The step a reopen sends a closed task to (T-28): the one the step it was closed at sends back to, else that step
 * (the flow's last when the history names none). Undefined while the flow loads.
 */
export function reopenTarget(task: TaskDetail, flow: Flow | null | undefined): string | undefined {
  const steps = flow?.steps ?? [];
  const closed = task.history.findLast((event) => event.kind === 'done' || event.kind === 'cancelled');
  const from = steps.find((step) => step.id === closed?.from?.id) ?? steps.at(-1);
  return from?.sendsBackTo ?? from?.name;
}

/**
 * Reopen's correction (T-28), under the buttons of a done or cancelled task: what is wrong (required) and what to change
 * (kept with it as the round's note), sent as the `reopen` move; the task goes back for another round.
 */
export function ReopenPanel({
  task,
  flow,
  busy,
  onSend,
  onClose,
}: {
  readonly task: TaskDetail;
  readonly flow: Flow | null | undefined;
  readonly busy: boolean;
  readonly onSend: (move: Omit<TaskMove, 'fromStepId'>) => void;
  readonly onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  const [findings, setFindings] = useState('');
  const target = reopenTarget(task, flow);
  const why = reason.trim();
  const what = findings.trim();
  const send = () => onSend({ action: 'reopen', reason: why, ...(what ? { findings: what } : {}) });
  return (
    <div className="flex flex-col gap-2 rounded-xl bg-surface-2 p-3">
      <p className="text-xs text-ink-2">
        {task.key} goes back to {target ?? 'its step'} for another round, in that step's same conversation, with
        your correction.
      </p>
      <Input
        size="sm"
        aria-label="What is wrong"
        placeholder="What is wrong, in a sentence"
        maxLength={TASK_REASON_MAX}
        value={reason}
        onChange={(event) => setReason(event.target.value)}
      />
      <Textarea
        aria-label="What to change"
        placeholder="What to change, where (optional)"
        rows={4}
        maxLength={TOOL_TEXT_MAX}
        value={findings}
        onChange={(event) => setFindings(event.target.value)}
        className="min-h-24 text-sm"
      />
      <div className="flex justify-end gap-2">
        <Button size="sm" tone="quiet" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button size="sm" tone="primary" icon={RotateCcw} busy={busy} disabled={why === ''} onClick={send}>
          Reopen{target ? ` → ${target}` : ''}
        </Button>
      </div>
    </div>
  );
}
