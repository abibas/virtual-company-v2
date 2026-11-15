import { type FormEvent, useState } from 'react';
import { friendlyMessage } from '../../../api/errors.ts';
import type { Board, FlowCalls } from '../../../api/flows.ts';
import { TextField } from '../../../components/forms/Field.tsx';
import { Sheet } from '../../../components/layout/Drawer.tsx';
import { Button } from '../../../components/ui/Button.tsx';
import { Notice } from '../../../components/ui/Notice.tsx';
import { defaultSprintName, endQuestion } from './words.ts';

/** A sprint's name, as the API takes it. */
const NAME_MAX = 80;

/**
 * New sprint… (T-37, those who lead the team): asks first ("End Sprint 3 (since …)? 12 done, 2 cancelled. 2 queued and
 * 1 in progress carry over to Sprint 4."), with the new sprint's name ("Sprint 4 · Mon 16 Nov" unless changed); its
 * confirmation ends the current sprint, writes its report and carries the open tasks over.
 */
export function NewSprintSheet({
  board,
  calls,
  onClose,
  onStarted,
}: {
  readonly board: Board;
  readonly calls: FlowCalls;
  readonly onClose: () => void;
  readonly onStarted: () => void;
}) {
  const next = board.sprint.number + 1;
  const [name, setName] = useState(() => defaultSprintName(next));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await calls.newSprint(board.flow.id, name.trim() || undefined);
      onStarted();
    } catch (failure) {
      setError(friendlyMessage(failure));
      setBusy(false);
    }
  };
  return (
    <Sheet open onClose={onClose} title={`New sprint in ${board.flow.name}`}>
      <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
        <p className="text-sm text-ink-2">{endQuestion(board)}</p>
        <p className="text-xs text-dim">
          The closed tasks stay in the sprint that ends, with its report on the Sprints tab. Running turns and
          Autotake go on.
        </p>
        <TextField
          label={`Name of Sprint ${next}`}
          hint="Optional"
          maxLength={NAME_MAX}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        {error && <Notice tone="error">{error}</Notice>}
        <div className="flex justify-end gap-2">
          <Button tone="quiet" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" tone="primary" busy={busy}>
            End and start Sprint {next}
          </Button>
        </div>
      </form>
    </Sheet>
  );
}
