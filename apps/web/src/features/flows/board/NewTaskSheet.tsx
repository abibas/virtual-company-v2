import type { TaskPriority } from '@mwc/shared/enums';
import { TASK_DESCRIPTION_MAX, TASK_TITLE } from '@mwc/shared/flows';
import { type FormEvent, useId, useState } from 'react';
import { friendlyMessage } from '../../../api/errors.ts';
import type { Flow, FlowCalls, TaskDetail } from '../../../api/flows.ts';
import { ChoiceField, Field, SelectField, TextField } from '../../../components/forms/Field.tsx';
import { Textarea } from '../../../components/forms/Input.tsx';
import { SegmentedControl } from '../../../components/forms/Segmented.tsx';
import { Sheet } from '../../../components/layout/Drawer.tsx';
import { Button } from '../../../components/ui/Button.tsx';
import { Notice } from '../../../components/ui/Notice.tsx';
import { PRIORITY, PRIORITY_ORDER } from '../words.ts';

/** The value of "start at" that leaves the task in Queued. */
const QUEUED = '';

/** The new task's fields and its creation (`POST …/tasks`): queued, or into the step chosen. */
function useNewTask(flow: Flow, calls: FlowCalls, onCreated: (task: TaskDetail) => void) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('normal');
  const [step, setStep] = useState(QUEUED);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const task = await calls.createTask({
        flowId: flow.id,
        title: title.trim(),
        priority,
        ...(description.trim() ? { description } : {}),
        ...(step !== QUEUED ? { stepId: step } : {}),
      });
      onCreated(task);
    } catch (failure) {
      setError(friendlyMessage(failure));
      setBusy(false);
    }
  };
  const fields = { title, setTitle, description, setDescription, priority, setPriority, step, setStep };
  return { ...fields, busy, error, submit };
}

/** The task's title and its description (Markdown). */
function Words({ task }: { readonly task: ReturnType<typeof useNewTask> }) {
  const id = useId();
  return (
    <>
      <TextField
        label="Title"
        required
        autoFocus
        maxLength={TASK_TITLE.max}
        value={task.title}
        onChange={(event) => task.setTitle(event.target.value)}
      />
      <Field label="Description" hint="Markdown" id={`${id}-description`}>
        <Textarea
          id={`${id}-description`}
          rows={8}
          maxLength={TASK_DESCRIPTION_MAX}
          value={task.description}
          onChange={(event) => task.setDescription(event.target.value)}
          className="font-mono text-sm"
        />
      </Field>
    </>
  );
}

/**
 * A new task in the team's flow: its title, its description (Markdown), its priority and, for the Lead's people and
 * admins (`leads`), the step it starts at (Queued without one).
 */
export function NewTaskSheet({
  flow,
  leads,
  calls,
  onClose,
  onCreated,
}: {
  readonly flow: Flow;
  readonly leads: boolean;
  readonly calls: FlowCalls;
  readonly onClose: () => void;
  readonly onCreated: (task: TaskDetail) => void;
}) {
  const task = useNewTask(flow, calls, onCreated);
  const steps = flow.steps.map((s) => ({ value: s.id, label: `${s.position}. ${s.name}` }));
  return (
    <Sheet open onClose={onClose} title={`New task in ${flow.name}`}>
      <form onSubmit={(event) => void task.submit(event)} className="flex flex-col gap-4">
        <Words task={task} />
        <ChoiceField label="Priority">
          <SegmentedControl<TaskPriority>
            label="Priority"
            size="sm"
            value={task.priority}
            onChange={task.setPriority}
            options={PRIORITY_ORDER.map((p) => ({ value: p, label: PRIORITY[p].label }))}
          />
        </ChoiceField>
        {leads && (
          <SelectField
            label="Start at"
            value={task.step}
            onChange={(event) => task.setStep(event.target.value)}
            options={[{ value: QUEUED, label: 'Queued' }, ...steps]}
          />
        )}
        {task.error && <Notice tone="error">{task.error}</Notice>}
        <div className="flex justify-end gap-2">
          <Button tone="quiet" onClick={onClose} disabled={task.busy}>
            Cancel
          </Button>
          <Button
            type="submit"
            tone="primary"
            busy={task.busy}
            disabled={task.title.trim().length < TASK_TITLE.min}
          >
            Create task
          </Button>
        </div>
      </form>
    </Sheet>
  );
}
