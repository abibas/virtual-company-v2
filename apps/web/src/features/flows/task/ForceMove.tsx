import { CircleStop } from 'lucide-react';
import type { FlowCalls, TaskDetail, TaskMove } from '../../../api/flows.ts';
import { ConfirmInline } from '../../../components/forms/ConfirmInline.tsx';
import { Button } from '../../../components/ui/Button.tsx';

/** What the step's person does once its agent's turn ended without a hand-off, by the step's kind. */
const OUTCOMES: Readonly<Record<string, string>> = {
  work: 'hand on',
  check: 'pass or send back',
  signoff: 'approve or send back',
};

/** The turn ended and nobody moved the task yet (S5.3b, before S6's tools): what to do now, in one line. */
export function TurnEnded({ task }: { readonly task: TaskDetail }) {
  if (task.stepState !== 'ended_without_handoff') return null;
  const outcome = OUTCOMES[task.step?.kind ?? 'work'] ?? 'hand on';
  return (
    <p className="text-xs text-dim">
      Turn ended. Read the reply, then {outcome}, or reply in the conversation.
    </p>
  );
}

/**
 * A move refused because the step's turn still runs (409 `step_running`): "Stop the turn and move" sends it again with
 * `force`, which stops the turn once the move is written; asked first, so nobody kills an agent's work by a stray
 * press. "Leave it" drops the move.
 */
export function ForceMove({
  task,
  move,
  calls,
  onMoved,
  onDismiss,
}: {
  readonly task: TaskDetail;
  readonly move: Omit<TaskMove, 'fromStepId'>;
  readonly calls: FlowCalls;
  readonly onMoved: () => void;
  readonly onDismiss: () => void;
}) {
  const force = async () => {
    await calls.act(task.key, { ...move, fromStepId: task.step?.id ?? null, force: true });
    onDismiss();
    onMoved();
  };
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-input-soft px-3 py-2">
      <p className="flex items-center gap-1.5 text-sm text-ink">
        <CircleStop size={14} aria-hidden="true" className="text-input" />
        The agent's turn at {task.step?.name ?? 'this step'} is still running.
      </p>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button size="sm" tone="quiet" onClick={onDismiss}>
          Leave it
        </Button>
        <ConfirmInline
          label="Stop the turn and move"
          question="Stop the agent's turn now and make this move? What it wrote so far stays in the conversation."
          confirmLabel="Stop and move"
          tone="secondary"
          onConfirm={force}
        />
      </div>
    </div>
  );
}
