import { ArrowUp } from 'lucide-react';
import { type FormEvent, useEffect, useId, useRef, useState } from 'react';
import { cx } from '../cx.ts';
import { IconButton } from '../ui/IconButton.tsx';
import { FacePicker } from './FacePicker.tsx';
import type { AgentRef } from './kinds.ts';

/** The task's words and the send button. */
function TaskInput({
  id,
  value,
  placeholder,
  disabled,
  onChange,
}: {
  readonly id: string;
  readonly value: string;
  readonly placeholder: string;
  readonly disabled: boolean;
  readonly onChange: (value: string) => void;
}) {
  return (
    <div className="mt-3 flex items-center gap-2">
      <label htmlFor={id} className="sr-only">
        The task
      </label>
      <input
        id={id}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="h-10 min-w-0 flex-1 rounded-full bg-surface px-4 text-sm text-ink ring-1 ring-line ring-inset outline-none placeholder:text-faint focus:ring-blue disabled:cursor-not-allowed disabled:opacity-60"
      />
      <IconButton
        type="submit"
        label="Create the task"
        icon={ArrowUp}
        tone="primary"
        round
        disabled={disabled || value.trim() === ''}
      />
    </div>
  );
}

/** Focuses the composer: its words when they can be typed, else the face picked, else the dock itself. */
function focusComposer(form: HTMLFormElement | null) {
  const target =
    form?.querySelector<HTMLElement>('input:not(:disabled)') ??
    form?.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]') ??
    form;
  target?.focus();
}

/**
 * The dock at the bottom of the right rail: pick an agent by its face, say what to do, send. The faces are the
 * team's; without `onCreate` (tasks arrive in S4) a face can be picked but the words and the send button wait,
 * with `disabledNote` saying why. `focusComposer` (the collapsed rail's "+") focuses the composer as it shows.
 */
export function QuickCreate({
  agents,
  onCreate,
  disabledNote,
  focusComposer: focusOnShow = false,
  className,
}: {
  readonly agents: readonly AgentRef[];
  /** Makes the task; absent, the words and the send button are disabled, with `disabledNote`. */
  readonly onCreate?: (agentId: string, text: string) => void;
  readonly disabledNote?: string | undefined;
  readonly focusComposer?: boolean | undefined;
  readonly className?: string;
}) {
  const id = useId();
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (focusOnShow) focusComposer(form.current);
  }, [focusOnShow]);
  const [agentId, setAgentId] = useState<string | undefined>(agents[0]?.id);
  const [text, setText] = useState('');
  const disabled = onCreate === undefined || agents.length === 0;
  const agent = agents.find((candidate) => candidate.id === agentId) ?? agents[0];
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!onCreate || !agent || text.trim() === '') return;
    onCreate(agent.id, text.trim());
    setText('');
  };
  return (
    <form
      ref={form}
      tabIndex={-1}
      onSubmit={submit}
      aria-labelledby={`${id}-title`}
      className={cx('rounded-xl bg-surface-2 p-3.5 outline-none', className)}
    >
      <div className="flex items-baseline justify-between gap-3">
        <h3 id={`${id}-title`} className="text-sm font-bold text-ink">
          Quick create task
        </h3>
        {disabled && disabledNote && <p className="text-xs text-dim">{disabledNote}</p>}
      </div>
      {agents.length > 0 ? (
        <FacePicker agents={agents} value={agent?.id} onChange={setAgentId} className="mt-3" />
      ) : (
        <p className="mt-3 text-xs text-dim">No agents yet: their faces show here once they are hired.</p>
      )}
      <TaskInput
        id={`${id}-text`}
        value={text}
        disabled={disabled}
        placeholder={agent ? `What should ${agent.name} do?` : 'Describe a task'}
        onChange={setText}
      />
    </form>
  );
}
