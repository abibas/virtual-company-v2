import { X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { friendlyMessage } from '../../../api/errors.ts';
import type { FlowCalls, TaskDetail } from '../../../api/flows.ts';
import { Link } from '../../../app/router.tsx';
import { cx } from '../../../components/cx.ts';
import { Select } from '../../../components/forms/Input.tsx';
import { TASK_STATE } from '../words.ts';

type Waits = TaskDetail['waitsFor'];
type Option = { readonly key: string; readonly title: string };

/** A task it waits for: its key linking to its page (struck through once done or cancelled), and × to drop it. */
function Chip({
  wait,
  href,
  onRemove,
}: {
  readonly wait: Waits[number];
  readonly href: string;
  readonly onRemove: (() => void) | undefined;
}) {
  const closed = wait.state === 'done' || wait.state === 'cancelled';
  return (
    <span className="inline-flex items-center gap-0.5 rounded-md bg-surface-2 py-0.5 pr-1 pl-1.5 text-xs ring-1 ring-line">
      <Link
        to={href}
        title={`${wait.title} · ${TASK_STATE[wait.state].label}`}
        className={cx('font-mono font-semibold hover:text-blue', closed && 'text-faint line-through')}
      >
        {wait.key}
      </Link>
      {onRemove && (
        <button
          type="button"
          aria-label={`Stop waiting for ${wait.key}`}
          onClick={onRemove}
          className="rounded-xs text-dim hover:text-failed"
        >
          <X size={12} aria-hidden="true" />
        </button>
      )}
    </span>
  );
}

/** The flow's open tasks it may wait for: not itself, not already chosen; read once when the picker shows. */
function useChoices(calls: FlowCalls, task: TaskDetail, enabled: boolean): readonly Option[] {
  const [open, setOpen] = useState<readonly Option[]>([]);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    calls.openTasks(task.flowId).then(
      (page) => live && setOpen(page.tasks.map((other) => ({ key: other.key, title: other.title }))),
      () => live && setOpen([]),
    );
    return () => {
      live = false;
    };
  }, [calls, task.flowId, enabled]);
  return open.filter(
    (other) => other.key !== task.key && !task.waitsFor.some((wait) => wait.key === other.key),
  );
}

/**
 * What a task waits for (T-39): chips of the flow's tasks it waits for (each linking to its page, struck through once
 * done or cancelled); Autotake skips it until each is. Those who edit its priority change it while it is queued: × on
 * a chip, and a picker of the flow's open tasks to add one. Each change saves at once.
 */
export function TaskWaits({
  task,
  editable,
  calls,
  taskHref,
  onSave,
}: {
  readonly task: TaskDetail;
  readonly editable: boolean;
  readonly calls: FlowCalls;
  readonly taskHref: (key: string) => string;
  readonly onSave: (keys: string[]) => Promise<unknown>;
}) {
  const [error, setError] = useState<string>();
  const choices = useChoices(calls, task, editable);
  const keys = task.waitsFor.map((wait) => wait.key);
  const save = (next: string[]) => {
    setError(undefined);
    onSave(next).catch((failure: unknown) => setError(friendlyMessage(failure)));
  };
  if (!editable && keys.length === 0) return <span className="text-dim">Nothing</span>;
  return (
    <span className="flex min-w-0 flex-col items-end gap-1">
      {keys.length > 0 && (
        <span className="flex flex-wrap justify-end gap-1">
          {task.waitsFor.map((wait) => (
            <Chip
              key={wait.id}
              wait={wait}
              href={taskHref(wait.key)}
              onRemove={editable ? () => save(keys.filter((key) => key !== wait.key)) : undefined}
            />
          ))}
        </span>
      )}
      {editable && (
        <Select
          size="sm"
          aria-label="Wait for a task"
          value=""
          className="w-40!"
          onChange={(event) => event.target.value && save([...keys, event.target.value])}
          options={[
            { value: '', label: keys.length > 0 ? 'Add another…' : 'Add a task…' },
            ...choices.map((other) => ({ value: other.key, label: `${other.key} · ${other.title}` })),
          ]}
        />
      )}
      {error && <span className="text-2xs text-failed">{error}</span>}
    </span>
  );
}
